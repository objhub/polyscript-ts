# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Modifiers) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

Operations are chained with `|`:

```
box 50 50 10 | fillet 2 | diff cylinder 5 10
```

### Modifiers

```
| fillet expr              # fillet all edges
| chamfer expr             # chamfer all edges
| shell expr               # hollow out; select face first to remove it
| offset d                 # offset wire or face outline (positive = outward, negative = inward)
```

```
box 100 60 40
 | edges =Z | fillet 3
 | faces >Z | shell 2
```

`fillet` also works on 2D wires, letting you create rounded 2D profiles:

```
rect 40 20 | fillet 3 | extrude 10     # extrude a rounded rectangle
```

`offset` works in two contexts:

- **Face selection context**: Extracts the outline of the selected face, creates a workplane, and offsets the outline. → Face
- **Face**: Scales the outline similarly (`+` outward, `-` inward). A face with holes cannot be offset. → Face
- **Wire**: Gives the line a thickness. An open wire becomes a band of width `2|d|` (round ends by default, `cap:"square"` for flat ends); a closed wire becomes a ring of width `2|d|`. → Face

```
# Face selection → offset → cut
box 80 60 10
 | faces >Z
 | offset -10
 | cut 3

# Face → offset
rect 80 60 | offset -10 | extrude 5

# Wire → offset: turn a polyline into a band 4 wide, then extrude
wire [(0,0), (40,0), (40,30)] | offset 2 | extrude 5
```

