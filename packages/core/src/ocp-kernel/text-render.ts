/**
 * Text rendering — converts text strings to occt-wasm wires using opentype.js.
 *
 * Extracts glyph outlines (lines + bezier curves) from TrueType/OpenType fonts,
 * converts them to 3D wires on the workplane, and centers the result.
 *
 * Falls back to null when opentype.js is unavailable or no font can be loaded,
 * allowing callers to use the rectangular placeholder.
 */

import type { OC, Pln, Wire } from './types.js';
import { to3d } from './geometry.js';
import * as opentype from 'opentype.js';

// ---------------------------------------------------------------------------
// Types for opentype.js path commands
// ---------------------------------------------------------------------------

interface MoveToCmd { type: 'M'; x: number; y: number }
interface LineToCmd { type: 'L'; x: number; y: number }
interface QuadCmd   { type: 'Q'; x1: number; y1: number; x: number; y: number }
interface CubicCmd  { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
interface CloseCmd  { type: 'Z' }
type PathCommand = MoveToCmd | LineToCmd | QuadCmd | CubicCmd | CloseCmd;

interface OpentypePath {
  commands: PathCommand[];
}

interface OpentypeFont {
  ascender: number;
  descender: number;
  unitsPerEm: number;
  getPath(text: string, x: number, y: number, fontSize: number): OpentypePath;
  getAdvanceWidth(text: string, fontSize: number): number;
}

// ---------------------------------------------------------------------------
// Node.js built-ins, reached without a static import
// ---------------------------------------------------------------------------

// System-font search needs `fs` and `path`, which exist only in Node. They must
// not be reached through a static `import`: a bundler resolves those at build
// time, so a browser build of this module fails outright rather than falling
// back at runtime. `process.getBuiltinModule` (Node 20.16+/22.3+) hands them
// over at runtime instead, and is simply absent in a browser -- which is the
// signal we want.
function nodeBuiltin<T>(name: string): T | null {
  const getter = (globalThis as { process?: { getBuiltinModule?: (n: string) => unknown } })
    .process?.getBuiltinModule;
  if (typeof getter !== 'function') return null;
  try {
    return getter(name) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Font cache — lazy-loaded, browser/Node dual-path
// ---------------------------------------------------------------------------

/** User-supplied font buffer for browser environments. */
let _userFontBuffer: ArrayBuffer | null = null;

/** Cached parsed Font object. */
let _cachedFont: OpentypeFont | null | undefined; // undefined = not yet attempted

/**
 * Set a font buffer (ArrayBuffer) for use in browser environments.
 * Call this before any text rendering to provide a TrueType/OpenType font.
 */
export function setTextFont(buffer: ArrayBuffer): void {
  _userFontBuffer = buffer;
  _cachedFont = undefined; // reset cache so next call re-parses
}

/**
 * Reset the font cache (useful for testing).
 */
export function resetFontCache(): void {
  _cachedFont = undefined;
  _userFontBuffer = null;
}

/** Well-known sans-serif font names to search. */
const PREFERRED_FONTS = [
  'DejaVuSans.ttf',
  'LiberationSans-Regular.ttf',
  'NotoSans-Regular.ttf',
  'Roboto-Regular.ttf',
  'Arial.ttf',
];

/** Common system font directories. */
const SEARCH_DIRS = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  '/System/Library/Fonts',
  '/Library/Fonts',
  'C:\\Windows\\Fonts',
];

/**
 * Search the filesystem for a TrueType font file (Node.js only).
 * Returns the file path or null.
 */
function findFontNode(): string | null {
  const fs = nodeBuiltin<typeof import('fs')>('fs');
  const path = nodeBuiltin<typeof import('path')>('path');
  if (!fs || !path) return null;
  try {

    // Also search ~/Library/Fonts on macOS
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const allDirs = [...SEARCH_DIRS];
    if (homeDir) {
      allDirs.push(path.join(homeDir, 'Library', 'Fonts'));
    }

    for (const fontName of PREFERRED_FONTS) {
      for (const dir of allDirs) {
        try {
          const found = findFileRecursive(fs, path, dir, fontName);
          if (found) return found;
        } catch {
          // directory doesn't exist or not readable
        }
      }
    }

    // Fallback: first .ttf found
    for (const dir of allDirs) {
      try {
        const found = findFirstTTF(fs, path, dir);
        if (found) return found;
      } catch {
        // directory doesn't exist or not readable
      }
    }
  } catch {
    // fs/path not available (browser environment)
  }
  return null;
}

function findFileRecursive(
  fs: typeof import('fs'),
  path: typeof import('path'),
  dir: string,
  target: string,
): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileRecursive(fs, path, full, target);
        if (found) return found;
      } else if (entry.name === target) {
        return full;
      }
    }
  } catch {
    // permission denied or non-existent
  }
  return null;
}

function findFirstTTF(
  fs: typeof import('fs'),
  path: typeof import('path'),
  dir: string,
): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFirstTTF(fs, path, full);
        if (found) return found;
      } else if (entry.name.endsWith('.ttf')) {
        return full;
      }
    }
  } catch {
    // permission denied or non-existent
  }
  return null;
}

/**
 * Attempt to load an opentype.js Font object.
 * Uses user-supplied buffer, or searches system fonts (Node.js).
 * Returns null on failure.
 */
function loadFont(): OpentypeFont | null {
  if (_cachedFont !== undefined) return _cachedFont;

  try {
    // Priority 1: user-supplied buffer (the only path a browser can take,
    // via setTextFont)
    if (_userFontBuffer) {
      _cachedFont = opentype.parse(_userFontBuffer) as unknown as OpentypeFont;
      return _cachedFont;
    }

    // Priority 2: Node.js system font search. `loadSync` reads the file
    // through opentype.js's own lazy `require('fs')`, so it works in Node and
    // throws in a browser -- where findFontNode has already returned null.
    const fontPath = findFontNode();
    if (fontPath) {
      _cachedFont = opentype.loadSync(fontPath) as unknown as OpentypeFont;
      return _cachedFont;
    }
  } catch {
    // opentype.js not available or font loading failed
  }

  _cachedFont = null;
  return null;
}

// ---------------------------------------------------------------------------
// Glyph path -> occt-wasm wire conversion
// ---------------------------------------------------------------------------

/**
 * Convert text content to an array of closed wires on the given workplane.
 *
 * The text is rendered at `size` units height (ascender - descender = size),
 * centered horizontally and vertically about the workplane origin.
 *
 * Returns null if font loading fails (caller should fall back to placeholder).
 */
export function textToWires(
  oc: OC,
  content: string,
  size: number,
  plane: Pln,
): Wire[] | null {
  if (!content) return null;

  const font = loadFont();
  if (!font) return null;

  // opentype.js getPath renders at fontSize where 1 em = unitsPerEm
  // We want ascender-descender = size (matching Python's freetype behaviour)
  const unitsHeight = font.ascender - font.descender;
  if (unitsHeight === 0) return null;
  const fontSize = size * font.unitsPerEm / unitsHeight;

  // Get the path at origin (0, 0), baseline at y=0
  // Note: opentype.js uses y-down convention (SVG/screen coords), but font
  // metrics (ascender > 0, descender < 0) are in y-up coordinates.
  // getPath with y=0 puts the baseline at y=0 in screen coords (y-down),
  // meaning glyphs extend upward (negative y in screen) and downward (positive y).
  // We negate Y to convert to CAD y-up convention.
  const path = font.getPath(content, 0, 0, fontSize);
  const totalWidth = font.getAdvanceWidth(content, fontSize);

  // Build contours from path commands
  const contours = pathToContours(path.commands);
  if (contours.length === 0) return null;

  // Centre: shift left by half total width, vertically by half (asc+desc)
  const shiftX = -totalWidth / 2;
  const asc = font.ascender * fontSize / font.unitsPerEm;
  const desc = font.descender * fontSize / font.unitsPerEm; // negative
  // In y-up coords: asc is top, desc is bottom. Center = (asc + desc) / 2
  const shiftY = -(asc + desc) / 2;

  // Convert each contour to an occt wire
  const wires: Wire[] = [];
  for (const contour of contours) {
    const wire = contourToWire(oc, contour, plane, shiftX, shiftY);
    if (wire) wires.push(wire);
  }

  return wires.length > 0 ? wires : null;
}

// ---------------------------------------------------------------------------
// Path command processing
// ---------------------------------------------------------------------------

/** A contour: sequence of segments making up a closed sub-path. */
interface Segment {
  type: 'line' | 'cubic';
  /** Start point (x, y) in CAD coords (y-up). */
  start: [number, number];
  /** For line: end point. For cubic: cp1, cp2, end. */
  points: [number, number][];
}

interface Contour {
  segments: Segment[];
}

/**
 * Split opentype.js path commands into individual closed contours.
 * Each M...Z span becomes one contour.
 *
 * opentype.js uses y-down (screen) convention; we negate Y here
 * to convert to CAD y-up convention.
 */
function pathToContours(commands: PathCommand[]): Contour[] {
  const contours: Contour[] = [];
  let currentContour: Segment[] = [];
  let currentX = 0;
  let currentY = 0;
  let contourStartX = 0;
  let contourStartY = 0;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        // If we have an open contour, close it implicitly
        if (currentContour.length > 0) {
          contours.push({ segments: currentContour });
          currentContour = [];
        }
        currentX = cmd.x;
        currentY = -cmd.y; // y-down -> y-up
        contourStartX = currentX;
        contourStartY = currentY;
        break;

      case 'L': {
        const sx = currentX, sy = currentY;
        currentX = cmd.x;
        currentY = -cmd.y; // y-down -> y-up
        // Skip degenerate edges
        if (Math.abs(sx - currentX) > 1e-8 || Math.abs(sy - currentY) > 1e-8) {
          currentContour.push({
            type: 'line',
            start: [sx, sy],
            points: [[currentX, currentY]],
          });
        }
        break;
      }

      case 'Q': {
        // Quadratic bezier -> cubic bezier (degree elevation)
        const sx = currentX, sy = currentY;
        const qx1 = cmd.x1, qy1 = -cmd.y1; // y-down -> y-up
        const qx = cmd.x, qy = -cmd.y;
        currentX = qx;
        currentY = qy;
        // Skip degenerate
        if (Math.abs(sx - qx) < 1e-8 && Math.abs(sy - qy) < 1e-8) break;
        // Degree-elevate: Q(p0, p1, p2) -> C(p0, p0+2/3*(p1-p0), p2+2/3*(p1-p2), p2)
        const cp1x = sx + (2 / 3) * (qx1 - sx);
        const cp1y = sy + (2 / 3) * (qy1 - sy);
        const cp2x = qx + (2 / 3) * (qx1 - qx);
        const cp2y = qy + (2 / 3) * (qy1 - qy);
        currentContour.push({
          type: 'cubic',
          start: [sx, sy],
          points: [[cp1x, cp1y], [cp2x, cp2y], [qx, qy]],
        });
        break;
      }

      case 'C': {
        const sx = currentX, sy = currentY;
        const cx1 = cmd.x1, cy1 = -cmd.y1; // y-down -> y-up
        const cx2 = cmd.x2, cy2 = -cmd.y2;
        const cx = cmd.x, cy = -cmd.y;
        currentX = cx;
        currentY = cy;
        // Skip degenerate
        if (Math.abs(sx - cx) < 1e-8 && Math.abs(sy - cy) < 1e-8) break;
        currentContour.push({
          type: 'cubic',
          start: [sx, sy],
          points: [[cx1, cy1], [cx2, cy2], [cx, cy]],
        });
        break;
      }

      case 'Z': {
        // Close path: add closing segment if needed
        if (Math.abs(currentX - contourStartX) > 1e-8 || Math.abs(currentY - contourStartY) > 1e-8) {
          currentContour.push({
            type: 'line',
            start: [currentX, currentY],
            points: [[contourStartX, contourStartY]],
          });
        }
        currentX = contourStartX;
        currentY = contourStartY;
        if (currentContour.length > 0) {
          contours.push({ segments: currentContour });
          currentContour = [];
        }
        break;
      }
    }
  }

  // Handle unclosed contour at end (shouldn't happen with well-formed fonts)
  if (currentContour.length > 0) {
    contours.push({ segments: currentContour });
  }

  return contours;
}

/**
 * Convert a contour (list of segments) to an occt-wasm wire.
 * Applies (shiftX, shiftY) centering offset to all points.
 */
function contourToWire(
  oc: OC,
  contour: Contour,
  plane: Pln,
  shiftX: number,
  shiftY: number,
): Wire | null {
  const edges: Wire[] = [];

  for (const seg of contour.segments) {
    const [sx, sy] = seg.start;
    const p0 = to3d(oc, plane, sx + shiftX, sy + shiftY);

    if (seg.type === 'line') {
      const [ex, ey] = seg.points[0];
      const p1 = to3d(oc, plane, ex + shiftX, ey + shiftY);
      try {
        edges.push(oc.makeLineEdge(p0, p1));
      } catch {
        // degenerate edge -- skip
      }
    } else {
      // cubic bezier: 3 additional points (cp1, cp2, end)
      const [cp1x, cp1y] = seg.points[0];
      const [cp2x, cp2y] = seg.points[1];
      const [ex, ey] = seg.points[2];
      const cp1 = to3d(oc, plane, cp1x + shiftX, cp1y + shiftY);
      const cp2 = to3d(oc, plane, cp2x + shiftX, cp2y + shiftY);
      const p3 = to3d(oc, plane, ex + shiftX, ey + shiftY);
      try {
        edges.push(oc.makeBezierEdge([p0, cp1, cp2, p3]));
      } catch {
        // degenerate bezier -- skip
      }
    }
  }

  if (edges.length === 0) return null;

  try {
    return oc.makeWire(edges);
  } catch {
    return null;
  }
}
