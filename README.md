# PolyScript

A pipe-based parametric CAD language built on OpenCascade that exports STL and STEP files.

```
box 80 60 10
 | fillet 2
 | faces ">Z" | workplane
 | circle 10 | cut
```

This is the TypeScript implementation. It ships as a single binary with the
OpenCascade kernel compiled to WebAssembly, so there is no runtime or CAD
kernel to install.

## Features

- **Pipe syntax** -- chain operations with `|` for readable modeling workflows
- **No install footprint** -- OpenCascade runs as WebAssembly inside the binary
- **Functions** -- define reusable parametric shapes with `def`
- **Import** -- split libraries into separate `.poly` files
- **Expressions** -- arithmetic, comparisons, `if/then/else`, list comprehensions
- **Parameters** -- override values from the command line without editing the source
- **Headless verification** -- `poly info` and `--trace` report what was actually built
- **Export** -- STL, STEP

## Download

https://github.com/objhub/polyscript-ts/releases

Download the archive for your platform, extract it, and put `poly` on your PATH.
The binary is self-contained.

## Quick Start

Create `hello.poly`:

```
box 30 20 10 | fillet 2
```

Build:

```bash
poly hello.poly                     # → hello.stl (default)
poly hello.poly -o hello.step       # export STEP
```

## Examples

### L-bracket

```
polyline [(0,0), (50,0), (50,5), (5,5), (5,30), (0,30)]
 | extrude 20
 | faces ">Z" | chamfer 1
```

### Hex nut

```
r = 10
polygon 6 r
 | extrude 8
 | faces >Z | circle 4 | cut
 | faces >Z | chamfer 1
 | faces <Z | chamfer 1
```

### Parametric function

```
def standoff(r, h, hole_r) = cylinder r h | diff cylinder hole_r h

box 80 60 3 | fillet 1
 | union (standoff 4 10 1.5 at:[(-30,-20,0), (30,-20,0), (-30,20,0), (30,20,0)])
```

### Spacer stack

```
cylinder 12 2
 | diff cylinder 5 3
 | faces ">Z" | workplane
 | circle 8 | extrude 10
 | diff cylinder 5 12
 | faces ">Z" | workplane
 | circle 12 | extrude 2
 | diff cylinder 5 16
```

### Flanged pipe with bolt holes

```
cylinder 25 5
 | faces ">Z" | workplane
 | circle 15 | extrude 30
 | diff cylinder 12 40
 | faces "<Z" | workplane
 | points (polar 6 20)
 | hole 5 depth:5
```

### Parameters

`@param` declares the allowed range; `-D` overrides the value at build time.

```
@param 20..120
width = 80

box $width 60 10 | fillet 2
```

```bash
poly plate.poly -D width=120 -o plate.stl
```

## Documentation

- [PolyScript User Document](https://polyscript.objhub.org)

## CLI

```text
poly [build] <input.poly> [-o <output>]
```

`build` is the default subcommand, so `poly model.poly` works.

| Flag | Description |
|------|-------------|
| `-o file.stl` | Export as STL (default: `<input>.stl`) |
| `-o file.step` | Export as STEP |
| `-D, --define <k=v>` | Override a parameter (repeatable) |
| `--params-file <path>` | Read parameters from JSON (`-D` wins) |
| `--mesh-deflection <v>` | Mesh tessellation deflection (default 0.1; higher = coarser, smaller file) |
| `--trace` | Per-step selection counts, volume and solid counts |
| `--strict` | Treat warnings as errors (exit 3) |
| `--json` | Machine-readable report on stdout |
| `-v, --verbose` | Print B-Rep info for the result |

Other subcommands:

```bash
poly check model.poly          # parse and validate only
poly info model.poly           # bbox, volume, area, solids, validity, topology
poly info model.poly --json
poly dump-ast model.poly [--pretty]
```

`poly info` and `--trace` are the main way to catch a broken model without
looking at it -- a boolean that silently cut nothing still reports a valid
single solid, but its volume does not change.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | File read error |
| 2 | Syntax error |
| 3 | Validation error (with `--strict`, warnings too) |
| 4 | Evaluation or export error |

## License

MIT
