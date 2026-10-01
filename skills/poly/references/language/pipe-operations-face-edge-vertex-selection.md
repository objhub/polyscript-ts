# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Face / Edge / Vertex Selection) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Face / Edge / Vertex Selection

```
| faces selector           # select faces
| edges selector           # select edges
| verts selector           # select vertices
```

Selectors use short symbols or name aliases:

| Symbol | Meaning | Name alias |
|---|---|---|
| `>Z` | maximum (top) | `top` |
| `<Z` | minimum (bottom) | `bottom` |
| `>X` | maximum (right) | `right` |
| `<X` | minimum (left) | `left` |
| `>Y` | maximum (back) | `back` |
| `<Y` | minimum (front) | `front` |
| `=Z` | parallel to the Z axis (edges running along Z; faces containing Z = the sides) | |
| `=X`, `=Y` | parallel to the X / Y axis | |
| `=XY` | parallel to the XY plane (horizontal edges; the top and bottom faces) | |
| `=YZ`, `=XZ` | parallel to the YZ / XZ plane | |
| `+Z` | faces that face up (normal +Z) | |
| `-Z` | faces that face down (normal -Z) | |
| `+X`, `-X`, `+Y`, `-Y` | faces whose normal points that way | |

> **`>Z` vs `+Z`**: `>Z` selects by position (the highest face), `+Z` by direction (every face that faces up). On a box both are the one top face; on a stepped part `+Z` returns several. `+` / `-` apply to faces only; on edges they are an error. There is no "perpendicular" selector: an edge perpendicular to Z is `=XY`.

#### Compound selectors

Multiple selectors separated by spaces act as AND (intersection):

```
| edges >Z >X          # edges at both Z-max and X-max
```

Wrap selectors in list syntax for OR (union):

```
| edges [>Z, <Z]       # edges at Z-max or Z-min
```

#### Tagging with `as`

You can name faces or edges with `as` for later reference:

```
| faces <X as $left
| edges =Z as $top_edges
```

Face selection creates an implicit workplane, so you can pipe 2D primitives directly:

```
box 50 50 10
 | faces top
 | circle 5 | cut
 | edges <Z | fillet 1
```

In a Face/Wire context, `verts` returns the vertices of the current shape as a Vertex selection.
Vertex selection supports both 2D and 3D primitives -- each primitive is placed at every vertex position:

```
box 80 60 10
 | faces top
 | rect 70 50 | verts | circle 1 | cut
```

3D primitives work the same way. Each vertex becomes a placement point:

```
rect 100 100 | verts | box 1 1 1       # place a box at each of the 4 vertices
rect 100 100 | verts | sphere 2         # place a sphere at each of the 4 vertices
```

Vertex selection supports `translate` to offset all vertex positions while staying in the selection context. Points selection (`points`) also supports this:

```
rect 80 60 | verts | translate 10 10 10 | cone 2 0 6
box 80 60 10 | faces >Z | points (polar 4 15) | translate 5 5 0 | hole 3
```

