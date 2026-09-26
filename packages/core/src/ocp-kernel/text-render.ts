/**
 * Text rendering — converts text strings to occt-wasm wires using opentype.js.
 *
 * Extracts glyph outlines (lines + bezier curves) from TrueType/OpenType fonts,
 * converts them to 3D wires on the workplane, and centers the result.
 *
 * Falls back to null when opentype.js is unavailable or no font can be loaded,
 * allowing callers to use the rectangular placeholder.
 */

import type { OC, Pln, Wire, Face } from './types.js';
import { to3d } from './geometry.js';
import { pushWarning } from '../diagnostics.js';
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
  charToGlyphIndex(ch: string): number;
  tables?: { fvar?: unknown };
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

/** The variable-font warning is given once per loaded font. */
let _warnedVariable = false;

/** Where the cached font came from (a file path in Node, null for a buffer). */
let _cachedFontPath: string | null = null;

/** The font file text is rendered with, when it came from the filesystem. */
export function textFontPath(): string | null {
  return _cachedFontPath;
}

/**
 * Set a font buffer (ArrayBuffer) for use in browser environments.
 * Call this before any text rendering to provide a TrueType/OpenType font.
 */
export function setTextFont(buffer: ArrayBuffer): void {
  _userFontBuffer = buffer;
  _warnedVariable = false;
  _cachedFont = undefined; // reset cache so next call re-parses
}

/**
 * Reset the font cache (useful for testing).
 */
export function resetFontCache(): void {
  _cachedFont = undefined;
  _cachedFontPath = null;
  _userFontBuffer = null;
  _warnedVariable = false;
}

/**
 * Font files searched, in priority order (file names, compared ignoring
 * case). Noto Sans JP comes first so Japanese text renders and the glyphs
 * match live / objhub, which ship it; the Noto CJK packaging that Linux
 * distributions install (`fonts-noto-cjk`: one .ttc for JP/KR/SC/TC/HK) is
 * next, then the Latin-only fonts that were searched before.
 * TODO: let the user choose the font (a CLI option / @font annotation).
 */
const PREFERRED_FONTS = [
  'NotoSansJP-Regular.otf',
  'NotoSansJP-Regular.ttf',
  'NotoSansCJKjp-Regular.otf',
  'NotoSansCJK-Regular.ttc',
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
 * Search the filesystem for font files (Node.js only): those of
 * PREFERRED_FONTS that exist anywhere under the font directories, in
 * priority order, then the first .ttf / .otf found.
 */
function findFontCandidates(): string[] {
  const fs = nodeBuiltin<typeof import('fs')>('fs');
  const path = nodeBuiltin<typeof import('path')>('path');
  if (!fs || !path) return [];
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const dirs = [...SEARCH_DIRS];
  if (homeDir) {
    dirs.push(path.join(homeDir, 'Library', 'Fonts'));
    dirs.push(path.join(homeDir, '.local', 'share', 'fonts'));
    dirs.push(path.join(homeDir, '.fonts'));
  }

  // One walk, indexed by lower-cased file name: Windows ships `arial.ttf`,
  // which an exact-case match never found (it then took whatever .ttf came
  // first, possibly a symbol font).
  const byName = new Map<string, string>();
  let firstAny: string | null = null;
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: import('fs').Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing or unreadable
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        const lower = entry.name.toLowerCase();
        if (!byName.has(lower)) byName.set(lower, full);
        if (!firstAny && (lower.endsWith('.ttf') || lower.endsWith('.otf'))) firstAny = full;
      }
    }
  };
  for (const dir of dirs) walk(dir, 0);

  const out: string[] = [];
  for (const name of PREFERRED_FONTS) {
    const found = byName.get(name.toLowerCase());
    if (found) out.push(found);
  }
  if (firstAny && !out.includes(firstAny)) out.push(firstAny);
  return out;
}

// ---------------------------------------------------------------------------
// Font collections (.ttc)
// ---------------------------------------------------------------------------

/** The family names (name IDs 1 and 16) of the sfnt at `base` in `view`. */
function sfntFamilies(view: DataView, base: number): string[] {
  const numTables = view.getUint16(base + 4);
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    if (tag !== 'name') continue;
    const off = view.getUint32(rec + 8);
    const count = view.getUint16(off + 2);
    const strings = off + view.getUint16(off + 4);
    const out: string[] = [];
    for (let j = 0; j < count; j++) {
      const r = off + 6 + j * 12;
      const platform = view.getUint16(r);
      const nameId = view.getUint16(r + 6);
      if (platform !== 3 || (nameId !== 1 && nameId !== 16)) continue;
      const len = view.getUint16(r + 8);
      const start = strings + view.getUint16(r + 10);
      let str = '';
      for (let k = 0; k < len; k += 2) str += String.fromCharCode(view.getUint16(start + k));
      out.push(str);
    }
    return out;
  }
  return [];
}

/**
 * Extract one font from a TrueType collection as a standalone sfnt, which
 * opentype.js (1.x) can parse: it rejects the `ttcf` container. Table offsets
 * in a collection are relative to the file, so the tables are copied into a
 * fresh file with new offsets. Picks the first member whose family name
 * matches `prefer` (the JP member of Noto Sans CJK), else the first.
 */
export function fontFromCollection(buffer: ArrayBuffer, prefer: RegExp = /\bJP\b/): ArrayBuffer {
  const view = new DataView(buffer);
  const numFonts = view.getUint32(8);
  let base = view.getUint32(12);
  for (let i = 0; i < numFonts; i++) {
    const b = view.getUint32(12 + i * 4);
    if (sfntFamilies(view, b).some(f => prefer.test(f))) { base = b; break; }
  }
  const numTables = view.getUint16(base + 4);
  const headerLen = 12 + numTables * 16;
  let size = headerLen;
  for (let i = 0; i < numTables; i++) size += (view.getUint32(base + 12 + i * 16 + 12) + 3) & ~3;
  const out = new Uint8Array(size);
  const outView = new DataView(out.buffer);
  const src = new Uint8Array(buffer);
  out.set(src.subarray(base, base + 12), 0);
  let pos = headerLen;
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    const off = view.getUint32(rec + 8);
    const len = view.getUint32(rec + 12);
    out.set(src.subarray(rec, rec + 16), 12 + i * 16);
    outView.setUint32(12 + i * 16 + 8, pos);
    out.set(src.subarray(off, off + len), pos);
    pos += (len + 3) & ~3;
  }
  return out.buffer;
}

/** A variable font (an `fvar` table). */
function isVariable(font: OpentypeFont): boolean {
  return !!font.tables?.fvar;
}

/** Parse a font file's bytes, unpacking a collection first. */
function parseFontBytes(buffer: ArrayBuffer): OpentypeFont {
  const tag = new DataView(buffer).getUint32(0);
  const bytes = tag === 0x74746366 /* 'ttcf' */ ? fontFromCollection(buffer) : buffer;
  return opentype.parse(bytes) as unknown as OpentypeFont;
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
      _cachedFontPath = null;
      _cachedFont = parseFontBytes(_userFontBuffer);
      return _cachedFont;
    }

    // Priority 2: Node.js system font search. A variable font is passed
    // over while a static one remains: opentype.js 1.x draws only its
    // default instance (often the Thin master) and its overlapping contours
    // break the nesting below.
    const fs = nodeBuiltin<typeof import('fs')>('fs');
    let variable: { font: OpentypeFont; path: string } | null = null;
    for (const fontPath of fs ? findFontCandidates() : []) {
      let font: OpentypeFont;
      try {
        const data = fs!.readFileSync(fontPath);
        font = parseFontBytes(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      } catch {
        continue; // unreadable or unparsable: try the next
      }
      if (isVariable(font)) {
        variable ??= { font, path: fontPath };
        continue;
      }
      _cachedFont = font;
      _cachedFontPath = fontPath;
      return _cachedFont;
    }
    if (variable) {
      _cachedFont = variable.font;
      _cachedFontPath = variable.path;
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
 * Render text to its glyph contours as closed wires on the given workplane,
 * paired with the 2D contour each wire came from (for nesting tests).
 *
 * The text is rendered at `size` units height (ascender - descender = size),
 * centered horizontally and vertically about the workplane origin.
 *
 * Returns null only when no font can be loaded; empty text (or only spaces)
 * gives an empty list.
 */
function textContourWires(
  oc: OC,
  content: string,
  size: number,
  plane: Pln,
): { contour: Contour; wire: Wire }[] | null {
  const font = loadFont();
  if (!font) return null;
  if (!content) return [];

  if (isVariable(font) && !_warnedVariable) {
    _warnedVariable = true;
    pushWarning('text: the font is a variable font; only its default instance is drawn '
      + '(often the thinnest weight), and overlapping contours can lose parts of letters', {
      hint: 'use a static font file (Noto Sans JP Regular .otf)'
        + (_cachedFontPath ? ` instead of ${_cachedFontPath}` : ''),
    });
  }

  // A character the font does not cover is drawn as its .notdef box, which
  // looks like a glyph. Say so: a Latin-only font given Japanese text.
  const missing = [...new Set([...content].filter(ch => ch.trim() !== '' && font.charToGlyphIndex(ch) === 0))];
  if (missing.length > 0) {
    pushWarning(`text: the font has no glyph for ${missing.map(c => `'${c}'`).join(' ')}; drawn as empty boxes`, {
      hint: `install Noto Sans JP, which the CLI prefers${_cachedFontPath ? ` (now using ${_cachedFontPath})` : ''}`,
    });
  }

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
  if (contours.length === 0) return [];

  // Centre: shift left by half total width, vertically by half (asc+desc)
  const shiftX = -totalWidth / 2;
  const asc = font.ascender * fontSize / font.unitsPerEm;
  const desc = font.descender * fontSize / font.unitsPerEm; // negative
  // In y-up coords: asc is top, desc is bottom. Center = (asc + desc) / 2
  const shiftY = -(asc + desc) / 2;

  // Convert each contour to an occt wire
  const out: { contour: Contour; wire: Wire }[] = [];
  for (const contour of contours) {
    const wire = contourToWire(oc, contour, plane, shiftX, shiftY);
    if (wire) out.push({ contour, wire });
  }

  return out.length > 0 ? out : null;
}

/**
 * Convert text content to an array of closed wires on the given workplane,
 * one per glyph contour (outer outlines and counters alike, unclassified).
 *
 * Returns null if font loading fails (caller should fall back to placeholder).
 */
export function textToWires(
  oc: OC,
  content: string,
  size: number,
  plane: Pln,
): Wire[] | null {
  const cw = textContourWires(oc, content, size, plane);
  return cw ? cw.map(c => c.wire) : null;
}

/**
 * Convert text content to faces on the given workplane: one face per outer
 * glyph contour, with its counters ("O", "8", "回") attached as holes.
 *
 * Contours are classified by nesting depth (even-odd): a contour enclosed by
 * an even number of others is an outline, an odd number makes it a hole of
 * the innermost enclosing outline. Nesting is decided on the 2D outline
 * coordinates, so it does not depend on the font's winding convention
 * (TrueType and CFF disagree on it).
 *
 * Returns null if font loading fails (caller should fall back to placeholder).
 */
export function textToFaces(
  oc: OC,
  content: string,
  size: number,
  plane: Pln,
): Face[] | null {
  const cw = textContourWires(oc, content, size, plane);
  if (!cw) return null;

  const polys = cw.map(c => contourPolygon(c.contour));
  const depth = polys.map((poly, i) => {
    const [px, py] = poly[0];
    let d = 0;
    for (let j = 0; j < polys.length; j++) {
      if (j !== i && pointInPolygon(px, py, polys[j])) d++;
    }
    return d;
  });

  const faces: Face[] = [];
  for (let i = 0; i < cw.length; i++) {
    if (depth[i] % 2 !== 0) continue;  // a hole; attached to its outline below
    const holes: Wire[] = [];
    for (let h = 0; h < cw.length; h++) {
      // One level deeper and inside this outline: every other contour that
      // encloses h also encloses i, so i is h's innermost container.
      if (depth[h] !== depth[i] + 1) continue;
      const [hx, hy] = polys[h][0];
      if (pointInPolygon(hx, hy, polys[i])) holes.push(cw[h].wire);
    }
    faces.push(faceWithHoles(oc, cw[i].wire, holes));
  }
  return faces.length > 0 ? faces : null;
}

/** A face from an outline wire and its hole wires. Falls back to the plain
 * outline (the pre-2026-09 behaviour) if the kernel refuses the holes. */
function faceWithHoles(oc: OC, outer: Wire, holes: Wire[]): Face {
  const face = oc.makeFace(outer);
  if (holes.length === 0) return face;
  try {
    return oc.addHolesInFace(face, holes);
  } catch {
    return face;
  }
}

/** Flatten a contour to a polygon for point-in-polygon tests; cubic segments
 * are sampled at a few parameters, which is plenty for nesting decisions. */
function contourPolygon(contour: Contour): [number, number][] {
  const pts: [number, number][] = [];
  for (const seg of contour.segments) {
    pts.push(seg.start);
    if (seg.type === 'cubic') {
      const [p0, [x1, y1], [x2, y2], [x3, y3]] = [seg.start, ...seg.points] as [number, number][];
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t;
        pts.push([
          u * u * u * p0[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * p0[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        ]);
      }
    }
  }
  return pts;
}

/** Ray-casting point-in-polygon (even-odd rule). */
function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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
