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
| `=Z` | parallel to Z | |
| `=X` | parallel to X | |
| `=Y` | parallel to Y | |
| `+Z` | perpendicular to Z (= side faces) | |
| `+X` | perpendicular to X | |
| `+Y` | perpendicular to Y | |

> **Note**: `+Z` selects faces whose normal is perpendicular to Z -- i.e., **side faces**, not the top or bottom. To select the top or bottom face, use `>Z` / `<Z`.

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

