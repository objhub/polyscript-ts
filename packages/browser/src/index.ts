/**
 * PolyScript browser-friendly high-level API.
 *
 * Provides a single-entry-point {@link PolyScriptEngine} class that bundles
 * parsing, validation, evaluation, and BREP-centric shape access.
 *
 * The build() method returns an opaque Shape handle. Export and tessellation
 * are performed separately via dedicated methods, enabling a
 * "tessellate for preview, export on save" workflow.
 */

import { parse, ParseError, type Program } from '@polyscript/core';
import { validate } from '@polyscript/core';
import { Evaluator } from '@polyscript/core';
import { EvalError } from '@polyscript/core';
import { extractParams as _extractParams } from '@polyscript/core';
import type { ParamInfo, ParamSet } from '@polyscript/core';
import type { Profile } from '@polyscript/core';
import { initOC } from '@polyscript/core/ocp-kernel';
import {
  exportSTLBuffer,
  exportSTEPString,
  exportBREPString,
  importBREP as _importBREP,
  exportGLTFBuffer,
  tessellate as _tessellate,
} from '@polyscript/core/ocp-kernel';
import type { ExportOptions, TessellationMesh } from '@polyscript/core/ocp-kernel';
import type { OC, Shape, Wire, WpState } from '@polyscript/core/ocp-kernel';
import { mergeColorMaps } from '@polyscript/core/ocp-kernel';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Parameter override values (e.g. from a GUI slider). */
  overrides?: Record<string, unknown>;
  /** Raw JSON string containing parameter-set definitions. */
  paramsJson?: string;
  /** Resolve `import "path"` statements to source strings. */
  importResolver?: (path: string) => string | null;
}

export interface BuildResult {
  /** The produced Shape handle, or null on failure. */
  shape: Shape | null;
  /** Color hint from the source (RGB 0..1), if set. */
  color?: [number, number, number];
  /** Per-shape color map (RGBA 0..1) for colored export. */
  colorMap: Map<Shape, [number, number, number, number]>;
  /** Errors collected across all phases. */
  errors: BuildError[];
  /** Declared @param annotations found in the source. */
  params: ParamInfo[];
  /** Named parameter sets declared in the source. */
  parameterSets: Record<string, Record<string, unknown>>;
  /** @profile presets extracted from source (undefined when absent). */
  profile?: Profile;
  /** True when a shape was successfully produced. */
  success: boolean;
  /** Tessellated polyline data for open wires (rendered as LineSegments). */
  lineMesh?: { positions: Float32Array; indices: Uint32Array };
}

export interface BuildError {
  phase: 'parse' | 'validate' | 'evaluate' | 'export';
  message: string;
  line?: number;
  column?: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class PolyScriptEngine {
  private oc: OC;

  private constructor(oc: OC) {
    this.oc = oc;
  }

  /**
   * Initialize the engine.  In a browser pass the URL or ArrayBuffer of the
   * WASM binary via `options.wasm`.
   */
  static async init(
    options?: { wasm?: string | ArrayBuffer },
  ): Promise<PolyScriptEngine> {
    const oc = await initOC(options);
    return new PolyScriptEngine(oc);
  }

  /**
   * Full build pipeline: parse -> validate -> evaluate.
   * Returns a Shape handle (no export step).
   */
  build(source: string, options?: BuildOptions): BuildResult {
    const errors: BuildError[] = [];

    // 1. Parse
    let program: Program;
    try {
      program = parse(source);
    } catch (e) {
      if (e instanceof ParseError) {
        errors.push({
          phase: 'parse',
          message: e.message,
          line: e.line,
          column: e.column,
        });
      } else {
        errors.push({ phase: 'parse', message: String(e) });
      }
      return { shape: null, colorMap: new Map(), errors, params: [], parameterSets: {}, profile: undefined, success: false };
    }

    // 2. Validate
    const valErrors = validate(program);
    for (const ve of valErrors) {
      errors.push({ phase: 'validate', message: ve.message });
    }

    // 3. Extract params
    let paramSet: ParamSet = { params: [], parameterSets: {} };
    try {
      paramSet = _extractParams(source, options?.paramsJson);
    } catch {
      /* non-fatal */
    }

    // 4. Evaluate
    let result: ReturnType<Evaluator['evaluate']>;
    try {
      const evaluator = new Evaluator({
        oc: this.oc,
        overrides: options?.overrides as Record<string, any> | undefined,
        importResolver: options?.importResolver,
        parseFn: parse,
      });
      result = evaluator.evaluate(program);
    } catch (e) {
      if (e instanceof EvalError) {
        errors.push({
          phase: 'evaluate',
          message: e.message,
          line: e.loc?.line,
          column: e.loc?.column,
        });
      } else {
        errors.push({ phase: 'evaluate', message: String(e) });
      }
      return {
        shape: null,
        colorMap: new Map(),
        errors,
        params: paramSet.params,
        parameterSets: paramSet.parameterSets,
        profile: paramSet.profile,
        success: false,
      };
    }

    // 5. Extract shape, color, and open wires from evaluation result
    const { shape, color, colorMap, openWires } = this.extractShapeAndColor(result);
    const lineMesh = this.tessellateWires(openWires);
    if (!shape && !lineMesh) {
      errors.push({ phase: 'export', message: 'No shape produced' });
      return {
        shape: null,
        colorMap: new Map(),
        errors,
        params: paramSet.params,
        parameterSets: paramSet.parameterSets,
        profile: paramSet.profile,
        success: false,
      };
    }

    return {
      shape,
      color,
      colorMap,
      errors,
      params: paramSet.params,
      parameterSets: paramSet.parameterSets,
      profile: paramSet.profile,
      success: true,
      lineMesh,
    };
  }

  // -----------------------------------------------------------------------
  // Export / import methods
  // -----------------------------------------------------------------------

  /** Export a Shape to STL binary (Uint8Array). */
  exportSTL(shape: Shape, options?: ExportOptions): Uint8Array {
    return exportSTLBuffer(this.oc, shape, options?.linearDeflection);
  }

  /** Export a Shape to STEP string. */
  exportSTEP(shape: Shape): string {
    return exportSTEPString(this.oc, shape);
  }

  /** Export a Shape to glTF (GLB) binary, with optional per-part colors. */
  exportGLTF(shape: Shape, options?: ExportOptions): Uint8Array {
    return exportGLTFBuffer(this.oc, shape, options);
  }

  /** Export a Shape to BREP string. */
  exportBREP(shape: Shape): string {
    return exportBREPString(this.oc, shape);
  }

  /** Import a BREP string back into a Shape. */
  importBREP(data: string): Shape {
    return _importBREP(this.oc, data);
  }

  /** Tessellate a Shape into positions, normals, and indices arrays. */
  tessellate(
    shape: Shape,
    options?: Pick<ExportOptions, 'linearDeflection' | 'angularDeflection'>,
  ): TessellationMesh {
    return _tessellate(this.oc, shape, options);
  }

  // -----------------------------------------------------------------------
  // Utility methods
  // -----------------------------------------------------------------------

  /** Extract @param annotations and parameter sets from source. */
  extractParams(source: string, jsonStr?: string): ParamSet {
    return _extractParams(source, jsonStr);
  }

  /** Parse + validate only (no kernel needed). */
  check(source: string): { errors: BuildError[] } {
    const errors: BuildError[] = [];
    let program: Program;
    try {
      program = parse(source);
    } catch (e) {
      if (e instanceof ParseError) {
        errors.push({
          phase: 'parse',
          message: e.message,
          line: e.line,
          column: e.column,
        });
      } else {
        errors.push({ phase: 'parse', message: String(e) });
      }
      return { errors };
    }
    const valErrors = validate(program);
    for (const ve of valErrors) {
      errors.push({ phase: 'validate', message: ve.message });
    }
    return { errors };
  }

  /** Direct access to the underlying OcctKernel. */
  get kernel(): OC {
    return this.oc;
  }

  // -- internal helpers ----------------------------------------------------

  private extractShapeAndColor(value: unknown): {
    shape: Shape | null;
    color?: [number, number, number];
    colorMap: Map<Shape, [number, number, number, number]>;
    openWires: Wire[];
  } {
    const allOpenWires: Wire[] = [];

    // Multiple top-level shapes: fuse them and merge colorMaps
    if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'shape' in value[0]) {
      const wpStates = value as WpState[];
      let fusedShape: Shape | null = null;
      let mergedColorMap: Map<Shape, [number, number, number, number]> | undefined;
      let firstColor: [number, number, number] | undefined;

      for (const wp of wpStates) {
        const { shape: wiresShape, openWires } = this.shapeAndLinesFromWires(wp.wires);
        allOpenWires.push(...openWires);
        let wpShape = wp.shape ?? wiresShape;
        if (wp.shape && wiresShape) {
          wpShape = this.oc.makeCompound([wp.shape, wiresShape]);
        }
        if (!wpShape) continue;

        // Collect color info into colorMap before fusing
        if (wp.color) {
          const alpha = wp.alpha ?? 1.0;
          const entryMap = new Map<Shape, [number, number, number, number]>();
          entryMap.set(wpShape, [wp.color[0], wp.color[1], wp.color[2], alpha]);
          mergedColorMap = mergeColorMaps(mergedColorMap, entryMap);
        }
        mergedColorMap = mergeColorMaps(mergedColorMap, wp.colorMap);

        if (!firstColor && wp.color) firstColor = wp.color;

        if (!fusedShape) {
          fusedShape = wpShape;
        } else {
          fusedShape = this.oc.fuse(fusedShape, wpShape);
        }
      }

      const colorMap = mergedColorMap ? new Map(mergedColorMap) : new Map<Shape, [number, number, number, number]>();
      return { shape: fusedShape, color: firstColor, colorMap, openWires: allOpenWires };
    }

    // Single WpState
    if (value && typeof value === 'object' && 'shape' in value) {
      const wp = value as WpState;
      const colorMap = wp.colorMap
        ? new Map(wp.colorMap)
        : new Map<Shape, [number, number, number, number]>();
      const { shape: wiresShape, openWires } = this.shapeAndLinesFromWires(wp.wires);
      allOpenWires.push(...openWires);
      let shape = wp.shape ?? wiresShape;
      if (wp.shape && wiresShape) {
        shape = this.oc.makeCompound([wp.shape, wiresShape]);
      }
      if (shape && wp.color && !colorMap.has(shape)) {
        const alpha = wp.alpha ?? 1.0;
        colorMap.set(shape, [wp.color[0], wp.color[1], wp.color[2], alpha]);
      }
      return { shape, color: wp.color, colorMap, openWires: allOpenWires };
    }
    return { shape: null, colorMap: new Map(), openWires: allOpenWires };
  }

  /**
   * Split wires into closed (→ faces) and open (→ line data).
   * Returns the closed-wire shape (null if no closed wires) and the list of open wires.
   */
  private shapeAndLinesFromWires(wires: Wire[]): { shape: Shape | null; openWires: Wire[] } {
    const faces: Shape[] = [];
    const openWires: Wire[] = [];
    for (const wire of wires) {
      if (this.isWireClosed(wire)) {
        try {
          faces.push(this.oc.makeFace(wire));
        } catch {
          // Closed wire that makeFace couldn't handle — treat as line
          openWires.push(wire);
        }
      } else {
        openWires.push(wire);
      }
    }
    let shape: Shape | null = null;
    if (faces.length === 1) shape = faces[0];
    else if (faces.length > 1) shape = this.oc.makeCompound(faces);
    return { shape, openWires };
  }

  /** Detect open/closed wire by comparing first/last sample points of wireframe. */
  private isWireClosed(wire: Wire, tol: number = 1e-6): boolean {
    try {
      const wf = this.oc.wireframe(wire, 0.1);
      if (wf.pointCount < 2) return false;
      const n = wf.points.length;
      if (n < 6) return false;
      const fx = wf.points[0], fy = wf.points[1], fz = wf.points[2];
      const lx = wf.points[n - 3], ly = wf.points[n - 2], lz = wf.points[n - 1];
      const d = Math.sqrt((fx - lx) ** 2 + (fy - ly) ** 2 + (fz - lz) ** 2);
      return d < tol;
    } catch {
      return false;
    }
  }

  /**
   * Tessellate a list of open wires into a single LineSegments mesh
   * (each edge's consecutive samples form line segments).
   *
   * Note: occt-wasm's EdgeData uses FLAT FLOAT indices for pointStart/pointCount
   * in edgeGroups (despite the spec wording), and `pointCount` (top-level) is
   * also the float count. Each point is 3 floats.
   */
  tessellateWires(wires: Wire[], deflection: number = 0.1): { positions: Float32Array; indices: Uint32Array } | undefined {
    if (wires.length === 0) return undefined;
    const positionsAll: number[] = [];
    const indicesAll: number[] = [];
    for (const wire of wires) {
      let wf: ReturnType<typeof this.oc.wireframe>;
      try {
        wf = this.oc.wireframe(wire, deflection);
      } catch {
        continue;
      }
      const baseIdx = positionsAll.length / 3;  // point-index base for this wire
      for (let i = 0; i < wf.points.length; i++) positionsAll.push(wf.points[i]);
      // edgeGroups: [floatStart, floatCount, hash] per edge
      for (let g = 0; g < wf.edgeCount; g++) {
        const floatStart = wf.edgeGroups[g * 3];
        const floatCount = wf.edgeGroups[g * 3 + 1];
        const pointStart = floatStart / 3;
        const pointCount = floatCount / 3;
        for (let i = 0; i < pointCount - 1; i++) {
          indicesAll.push(baseIdx + pointStart + i);
          indicesAll.push(baseIdx + pointStart + i + 1);
        }
      }
    }
    if (indicesAll.length === 0) return undefined;
    return {
      positions: new Float32Array(positionsAll),
      indices: new Uint32Array(indicesAll),
    };
  }
}

export type { ParamInfo, ParamSet };
export type { Profile, ProfileEntry } from '@polyscript/core';
export type { ExportOptions, TessellationMesh } from '@polyscript/core/ocp-kernel';
export type { Shape } from '@polyscript/core/ocp-kernel';
