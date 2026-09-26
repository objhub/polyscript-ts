# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Cut / Hole) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Cut / Hole

```
| cut depth                # cut through or to depth
| hole radius depth:d      # drill hole (radius, not diameter)
```

`hole` can be used from both FaceSelection and PointSelection.

- **From FaceSelection**: Drills a hole at the center of the selected face. `faces >Z | hole 5` is equivalent to `faces >Z | circle 5 | cut`. When multiple faces are selected, a hole is drilled at the center of each.
- **From PointSelection**: Drills a hole at each point position (the traditional behavior).

Omitting `depth:` creates a through-hole.

Use `at:` to specify the hole position. Use `origin:` to control the coordinate reference (see "Coordinate Reference" below).

```
# From face selection: hole at face center
box 80 60 10 | faces >Z | hole 5

# From point selection: hole at each point
box 80 60 10 | faces >Z | points (polar 4 15) | hole 5

# Hole at workplane coordinate (10,20)
box 80 60 10 | faces >Z | hole 5 at: 10 20

# Hole at world origin, projected onto face
box 80 60 10 | faces >Z | hole 5 at: 0 0 origin:"world"

# Hole at world coordinate (10,20,0) — 3 components = world
box 80 60 10 | faces >Z | hole 5 at: 10 20 0
```

```
rect 60 40 | extrude 15
 | faces top
 | rect 40 20 | cut 10
```

