// Usage: cd polyscript-ts && bun tests/scan_2d_types.ts
// Companion to devel/2d-face-wire202609.md: counts the constructs whose meaning
// changes when the 2D context is split into Face and Wire.
// Scan .poly files and poly code blocks: how would the Face/Wire split affect them?
import { parse } from '../packages/core/src/index.ts';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = '/home/hamano/Sync/project/polyscript';
const FACE_SRC = new Set(['RectExpr','CircleExpr','EllipseExpr','PolylineExpr','PolygonExpr','TextExpr','SketchExpr','Union','Diff','Inter']);
const WIRE_SRC = new Set(['WireLiteralExpr','LinePathExpr','ArcPathExpr','CenterArcPathExpr','BezierPathExpr','HelixPathExpr','SplinePathExpr']);
const SOLID_SRC = new Set(['BoxExpr','CylinderExpr','SphereExpr','ConeExpr','TorusExpr','WedgeExpr']);
const PRIM2D_KEYWORDS = new Set(['RectExpr','CircleExpr','EllipseExpr','PolylineExpr','PolygonExpr','TextExpr','SketchExpr','WireLiteralExpr']);

type Ctx = 'Face'|'Wire'|'3D'|'FaceSel'|'Points'|'WP'|'?';
const findings: Record<string, string[]> = {
  'stack: Face | Face-prim (implicit union)': [],
  'stack: Face | Wire-prim': [],
  'stack: Wire | any 2D prim': [],
  'Wire | extrude/cut/revolve/loft (implicit close)': [],
  'Wire | union/diff/inter': [],
  'Face | sweep (spine coercion)': [],
  'Wire | sweep': [],
  'Wire | offset': [],
  'Face | offset': [],
  'sketch literal': [],
  'wire literal': [],
  '? | 2D-only op (unresolved var)': [],
};
let files = 0, pipelines = 0;

function typeOfSource(e: any, vars: Map<string, Ctx>): Ctx {
  if (!e) return '?';
  if (FACE_SRC.has(e.type)) return 'Face';
  if (WIRE_SRC.has(e.type)) return 'Wire';
  if (SOLID_SRC.has(e.type)) return '3D';
  if (e.type === 'WorkplaneExpr' || e.type === 'Workplane') return 'WP';
  if (e.type === 'Pipeline') return walk(e, vars, false);
  if (e.type === 'VarRef') return vars.get(e.name) ?? '?';
  if (e.type === 'Grid' || e.type === 'Polar' || e.type === 'GridExpr' || e.type === 'PolarExpr') return '3D';
  return '?';
}

function note(k: string, where: string) { findings[k].push(where); }

function walk(p: any, vars: Map<string, Ctx>, top: boolean, where = ''): Ctx {
  pipelines++;
  let ctx = typeOfSource(p.source, vars);
  if (p.source?.type === 'SketchExpr') note('sketch literal', where);
  if (p.source?.type === 'WireLiteralExpr') note('wire literal', where);
  // scan nested expressions in source args too
  scanNested(p.source, vars, where);
  for (const op of p.ops) {
    const loc = `${where}:${op.loc?.line ?? '?'} ${op.type}`;
    scanNested(op, vars, where);
    switch (op.type) {
      case 'Implicit2DPrimitive': {
        const pt = op.primitive.type;
        const kind: Ctx = WIRE_SRC.has(pt) ? 'Wire' : FACE_SRC.has(pt) ? 'Face' : '?';
        if (pt === 'SketchExpr') note('sketch literal', where);
        if (pt === 'WireLiteralExpr') note('wire literal', where);
        if (ctx === 'Face') note(kind === 'Wire' ? 'stack: Face | Wire-prim' : 'stack: Face | Face-prim (implicit union)', loc);
        else if (ctx === 'Wire') note('stack: Wire | any 2D prim', loc);
        ctx = kind; break;
      }
      case 'Implicit3DPrimitive': ctx = '3D'; break;
      case 'FacesSelect': ctx = 'FaceSel'; break;
      case 'EdgesSelect': ctx = 'FaceSel'; break;
      case 'VertsSelect': case 'PointsSelect': ctx = 'Points'; break;
      case 'Workplane': ctx = 'WP'; break;
      case 'Extrude': case 'Cut': case 'Revolve': case 'Loft':
        if (ctx === 'Wire') note('Wire | extrude/cut/revolve/loft (implicit close)', loc);
        if (ctx === '?') note('? | 2D-only op (unresolved var)', loc);
        ctx = '3D'; break;
      case 'Sweep':
        if (ctx === 'Face') note('Face | sweep (spine coercion)', loc);
        if (ctx === 'Wire') note('Wire | sweep', loc);
        ctx = '3D'; break;
      case 'Union': case 'Diff': case 'Inter':
        if (ctx === 'Wire') note('Wire | union/diff/inter', loc);
        break;
      case 'Offset':
        if (ctx === 'Wire') note('Wire | offset', loc);
        if (ctx === 'Face') note('Face | offset', loc);
        if (ctx === 'FaceSel') ctx = 'Face';
        break;
      case 'Fillet': case 'Chamfer': case 'Shell': case 'Hole':
        if (ctx === 'FaceSel' || ctx === 'Points') ctx = '3D';
        break;
      default: break;
    }
  }
  return ctx;
}

function scanNested(node: any, vars: Map<string, Ctx>, where: string) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'ops' && node.type === 'Pipeline') continue;
    if (Array.isArray(v)) v.forEach(x => visit(x, vars, where));
    else if (v && typeof v === 'object') visit(v, vars, where);
  }
}
function visit(n: any, vars: Map<string, Ctx>, where: string) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'Pipeline') { walk(n, vars, false, where); return; }
  if (n.type === 'SketchExpr') note('sketch literal', where);
  if (n.type === 'WireLiteralExpr') note('wire literal', where);
  scanNested(n, vars, where);
}

function scanProgram(src: string, where: string) {
  let ast: any;
  try { ast = parse(src); } catch { return false; }
  files++;
  const vars = new Map<string, Ctx>();
  for (const st of ast.statements) {
    if (st.type === 'Assignment') {
      const t = st.value.type === 'Pipeline' ? walk(st.value, vars, true, where) : typeOfSource(st.value, vars);
      vars.set(st.name, t);
      if (st.value.type !== 'Pipeline') visit(st.value, vars, where);
    } else if (st.type === 'Pipeline') walk(st, vars, true, where);
    else if (st.type === 'FuncDef') visit(st.body, vars, where);
    else visit(st, vars, where);
  }
  return true;
}

function* polyFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (['node_modules','.svelte-kit','dist','.git','public'].includes(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* polyFiles(p);
    else if (extname(p) === '.poly') yield p;
  }
}
for (const f of polyFiles(ROOT)) scanProgram(readFileSync(f, 'utf8'), f.replace(ROOT + '/', ''));

// code blocks in docs
let blocks = 0, blockFail = 0;
function* mdFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (['node_modules','public','.git','archive'].includes(e)) continue;
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) yield* mdFiles(p); else if (p.endsWith('.md')) yield p;
  }
}
for (const dir of ['docs/content','zenn','devel', '.claude/skills']) {
  for (const f of mdFiles(join(ROOT, dir))) {
    const md = readFileSync(f, 'utf8');
    const re = /```(?:poly|polyscript)?\n([\s\S]*?)```/g; let m;
    while ((m = re.exec(md))) {
      blocks++;
      if (!scanProgram(m[1], f.replace(ROOT + '/', '') + '#L' + md.slice(0, m.index).split('\n').length)) blockFail++;
    }
  }
}
console.log(`parsed programs: ${files} (code blocks seen ${blocks}, unparsable ${blockFail}); pipelines ${pipelines}\n`);
for (const [k, v] of Object.entries(findings)) {
  console.log(`${k}: ${v.length}`);
  if (v.length && !k.includes('literal') && !k.startsWith('Face | offset')) for (const w of [...new Set(v)].slice(0, 40)) console.log('   ', w);
}
