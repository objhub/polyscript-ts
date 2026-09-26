# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Transform) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Transform

```
| translate x y z
| rotate rx ry rz            # solid: 3 angles (world axes), none may be omitted
| rotate a                   # 2D shape (Face/Wire): 1 angle, about the plane normal
| scale sx sy sz             # non-uniform scale (per axis)
| scale s                    # uniform scale (all axes)
| mirror "X"/"Y"/"Z"       # reflect; keep:true fuses with the original
| floor                      # align bottom face to z=0
| move dx dy           # 2D offset on workplane
| moveto x y           # 2D absolute position
```

`mirror` reflects across the plane perpendicular to the specified axis. `"X"` mirrors across the YZ plane, `"Y"` across the XZ plane, `"Z"` across the XY plane. The original is not kept; `keep:true` returns the original fused with its reflection, and `origin:` sets a point on the mirror plane (same forms as `rotate`). On 2D shapes on a workplane only `"X"` / `"Y"` apply, and the shape is mirrored within its plane.

```
box 30 20 10 | mirror "X"              # reflect across the YZ plane
half | mirror "Z" keep:true             # a symmetric whole from one half
box 30 20 10 | mirror "X" origin:(15, 0, 0)   # reflect across the plane x = 15
```

#### floor -- Align bottom to z=0

Translates any 3D shape so that its bounding box minimum Z (zmin) sits at z=0. Takes no arguments.

```
| floor
```

Internally this is equivalent to `translate 0 0 -bbox.zmin`. When you want to bottom-align a centered primitive, `| floor` is a one-pipe alternative to `center:(true,true,false)`.

```
# Bottom-align a centered box
box 10 10 10 | floor           # z=-5..+5 → z=0..10

# Works on spheres too
sphere 15 | floor              # z=-15..+15 → z=0..30

# Works on compound shapes
union [box 20 20 10, cylinder 5 20] | floor
```

> **Note**: `floor` is a pipe operation (it moves a shape). It is not the same as the math function `floor(x)` (which truncates a number toward negative infinity).

`move` offsets the drawing position relative to the current point on the workplane. `moveto` moves to an absolute position. Use `origin:` to change the coordinate reference (see "Coordinate Reference" below).

```
box 80 60 10
 | faces top
 | move 10 10 | circle 5 | cut      # hole offset (10,10) from face center
 | moveto 30 20 | rect 5 5 | cut    # pocket at (30,20) from workplane origin
```

```
# World XY coordinates projected onto face
| moveto 10 20 origin:"world"

# Arbitrary world point as new origin, then relative move
| moveto 5 5 origin:(10,20,0)

# World XY delta
| move 10 0 origin:"world"
```

#### How many arguments `rotate` takes

The count depends on what is being rotated and is never padded. A solid takes exactly
three angles, `rotate rx ry rz` (write `rotate 0 90 0` to turn about one axis); a 2D
shape on a workplane takes exactly one, `rotate a`, turning in its plane (it cannot be
tilted out of it). `rotate 0 90` is an error. A workplane with nothing drawn on it
cannot be rotated.

```
rect 10 5 | rotate 45                    # 2D: 45 degrees in the plane
faces >Z | rect 10 5 | rotate 30 | cut 3 # turn a sketch on a face, then cut
box 10 10 10 | rotate 0 0 45             # 3D: 45 degrees about Z
```

A 2D shape never leaves the workplane it was drawn on: `rotate 90 0 0` cannot stand it
up and `translate` cannot lift it (`poly check` reports both). To put a path or an
outline in a vertical plane (XZ / YZ), draw it there from the start, or use 3D points:

```
workplane XZ | wire [arc (0,-25) (25,0) center:(0,0)] | sweep (circle 5)  # arc path in the XZ plane
arc (0,0,-25) (25,0,0) center:(0,0,0) | sweep (circle 5)                 # the same path in 3D points
```

`move` / `moveto` do not move a drawn shape either: they move the cursor for the next
drawing. Place a shape when drawing it, e.g. `rect 10 10 at:(5, 5)`.

#### `origin:` keyword argument

`translate`, `rotate`, and `scale` accept the `origin:` keyword argument to specify the reference point.
For a 2D `rotate` the default is the workplane origin, `"local"` is the centre of the 2D
shape, and a 2-component point is in workplane coordinates.

| Value | Meaning | Default |
|---|---|---|
| `"world"` | Use world origin (0,0,0) | yes |
| `"local"` | Use object bounding box center | |
| `(x, y, z)` | Use an arbitrary point | |

```
# Rotate around world origin (default)
box 10 10 10 | translate 20 0 0 | rotate 0 0 45

# Rotate around object center
box 10 10 10 | translate 20 0 0 | rotate 0 0 45 origin:"local"

# Rotate around an arbitrary point
box 10 10 10 | rotate 0 0 45 origin:(10, 20, 0)

# Uniform scale (2x from origin)
box 10 10 10 | scale 2

# Non-uniform scale
box 10 10 10 | scale 2 1 0.5

# Scale from object center
box 10 10 10 | translate 20 0 0 | scale 3 origin:"local"
```

`move`, `moveto`, `hole`, and primitive `at:` also accept `origin:`. See the next section for details.

#### Coordinate Reference (`at:` and `origin:`)

When specifying a position with `at:`, the coordinate interpretation depends on the **number of components** by default. Use `origin:` to override explicitly.

**Default reference** (when `origin:` is omitted):

| Components | Reference | Example |
|---|---|---|
| 2-component `at: x y` | Workplane coordinates (WP origin) | `circle 5 at: 10 20` |
| 3-component `at: x y z` | World coordinates (projected onto face normal) | `circle 5 at: 10 20 0` |

**Explicit override**:

| `origin:` value | Meaning |
|---|---|
| `"world"` | Use world origin (0,0,0). Even 2-component coordinates are interpreted as world coordinates |
| `"local"` | Use workplane origin (same as the 2-component default) |
| `(ox, oy, oz)` | Use an arbitrary world point as the new origin; `at:` is interpreted as relative WP coordinates from that point |

World coordinates (3-component, or 2-component with `origin:"world"`) are projected onto the current workplane face along its normal direction.

`origin:` can be used with the following operations:

- Primitives with `at:`: `circle`, `rect`, `ellipse`, `polygon`, `box`, `cylinder`, `sphere`, `cone`, `torus`, `wedge`
- Hole drilling: `hole` (combined with `at:`)
- Cursor movement: `moveto`, `move`
- Transform: `translate`, `rotate`, `scale`

```
# 2-component at: uses workplane origin (default)
faces >Z | circle 5 at: 10 20                   # placed at WP (10,20)

# 3-component at: uses world coordinates (default)
faces >Z | circle 5 at: 10 20 0                 # world (10,20,0) projected

# origin:"world" makes 2-component world-relative too
faces >Z | circle 5 at: 10 20 origin:"world"    # world XY (10,20) projected

# origin:(ox,oy,oz) sets an arbitrary world point as origin
faces >Z | circle 5 at: 5 5 origin:(10,20,0)    # relative WP (5,5) from (10,20,0)

# Same applies to hole
faces >Z | hole 5 at: 0 0 origin:"world"        # hole at world origin
```


