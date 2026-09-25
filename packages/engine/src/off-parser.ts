/**
 * Parse an OFF file (with optional per-face colors) into mesh data for Three.js.
 *
 * Accepts Uint8Array (from FS.readFile binary) for best performance.
 * Parses directly on byte array without string conversion.
 *
 * OFF format:
 *   "OFF" header
 *   nVertices nFaces nEdges
 *   x y z              (per vertex)
 *   nVerts v0 v1 v2 [R G B [A]]  (per face, colors 0-255)
 */

import type { MeshData } from './stl-parser';

export function parseOFF(buf: Uint8Array): MeshData {
  const len = buf.length;
  let pos = 0;

  function skipWS(): void {
    while (pos < len) {
      const c = buf[pos];
      // Skip comments
      if (c === 0x23) {
        while (pos < len && buf[pos] !== 0x0a) pos++;
        continue;
      }
      if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a) {
        pos++;
        continue;
      }
      break;
    }
  }

  function readInt(): number {
    skipWS();
    let neg = false;
    if (buf[pos] === 0x2d) {
      neg = true;
      pos++;
    }
    let n = 0;
    while (pos < len) {
      const d = buf[pos] - 0x30;
      if (d < 0 || d > 9) break;
      n = n * 10 + d;
      pos++;
    }
    return neg ? -n : n;
  }

  function readFloat(): number {
    skipWS();
    let neg = false;
    if (buf[pos] === 0x2d) {
      neg = true;
      pos++;
    } else if (buf[pos] === 0x2b) {
      pos++;
    }
    let intPart = 0;
    while (pos < len) {
      const d = buf[pos] - 0x30;
      if (d < 0 || d > 9) break;
      intPart = intPart * 10 + d;
      pos++;
    }
    let fracPart = 0;
    let fracDiv = 1;
    if (pos < len && buf[pos] === 0x2e) {
      pos++;
      while (pos < len) {
        const d = buf[pos] - 0x30;
        if (d < 0 || d > 9) break;
        fracPart = fracPart * 10 + d;
        fracDiv *= 10;
        pos++;
      }
    }
    let val = intPart + fracPart / fracDiv;
    if (pos < len && (buf[pos] === 0x65 || buf[pos] === 0x45)) {
      pos++;
      let expNeg = false;
      if (buf[pos] === 0x2d) {
        expNeg = true;
        pos++;
      } else if (buf[pos] === 0x2b) {
        pos++;
      }
      let exp = 0;
      while (pos < len) {
        const d = buf[pos] - 0x30;
        if (d < 0 || d > 9) break;
        exp = exp * 10 + d;
        pos++;
      }
      val *= 10 ** (expNeg ? -exp : exp);
    }
    return neg ? -val : val;
  }

  function hasMoreOnLine(): boolean {
    let p = pos;
    while (p < len && (buf[p] === 0x20 || buf[p] === 0x09)) p++;
    return p < len && buf[p] !== 0x0a && buf[p] !== 0x0d;
  }

  // Skip "OFF" header
  skipWS();
  pos += 3;

  const nV = readInt();
  const nF = readInt();
  readInt(); // nEdges (ignored)

  // Read shared vertex positions
  const verts = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const idx = i * 3;
    verts[idx] = readFloat();
    verts[idx + 1] = readFloat();
    verts[idx + 2] = readFloat();
  }

  // First pass: read faces into intermediate arrays to count total triangles
  const inv255 = 1 / 255;
  const facesData: { vis: number[]; r: number; g: number; b: number; hasColor: boolean }[] = [];
  let totalTri = 0;
  let hasColor = false;

  for (let i = 0; i < nF; i++) {
    const nVerts = readInt();
    const vis: number[] = [];
    for (let j = 0; j < nVerts; j++) vis.push(readInt());
    let faceColor = { r: 0, g: 0, b: 0, fc: false };
    if (hasMoreOnLine()) {
      hasColor = true;
      faceColor = { r: readInt() * inv255, g: readInt() * inv255, b: readInt() * inv255, fc: true };
    }
    facesData.push({ vis, r: faceColor.r, g: faceColor.g, b: faceColor.b, hasColor: faceColor.fc });
    totalTri += Math.max(0, nVerts - 2);
  }

  // Second pass: expand to per-triangle vertices (fan triangulation)
  const positions = new Float32Array(totalTri * 9);
  const indices = new Uint32Array(totalTri * 3);
  const colorBuf = new Float32Array(totalTri * 9);
  let tri = 0;

  for (let i = 0; i < nF; i++) {
    const face = facesData[i];
    const vis = face.vis;
    const o0 = vis[0] * 3;
    for (let j = 1; j < vis.length - 1; j++) {
      const o1 = vis[j] * 3;
      const o2 = vis[j + 1] * 3;
      const base = tri * 9;
      positions[base]     = verts[o0];
      positions[base + 1] = verts[o0 + 1];
      positions[base + 2] = verts[o0 + 2];
      positions[base + 3] = verts[o1];
      positions[base + 4] = verts[o1 + 1];
      positions[base + 5] = verts[o1 + 2];
      positions[base + 6] = verts[o2];
      positions[base + 7] = verts[o2 + 1];
      positions[base + 8] = verts[o2 + 2];

      if (face.hasColor) {
        colorBuf[base]     = face.r;
        colorBuf[base + 1] = face.g;
        colorBuf[base + 2] = face.b;
        colorBuf[base + 3] = face.r;
        colorBuf[base + 4] = face.g;
        colorBuf[base + 5] = face.b;
        colorBuf[base + 6] = face.r;
        colorBuf[base + 7] = face.g;
        colorBuf[base + 8] = face.b;
      }

      const ii = tri * 3;
      indices[ii]     = ii;
      indices[ii + 1] = ii + 1;
      indices[ii + 2] = ii + 2;
      tri++;
    }
  }

  let colors: Float32Array | undefined;
  if (hasColor) {
    colors = colorBuf;
  }

  return { positions, normals: new Float32Array(0), indices, colors };
}
