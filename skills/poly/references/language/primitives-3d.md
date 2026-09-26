# PolyScript language: Primitives

> GENERATED from docs/content/en/language.md (Primitives > 3D) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Primitives

### 3D

```
box width height depth
cylinder radius height
sphere radius
cone r1 r2 height
torus r1 r2
wedge dx dy dz ltx
```

`cone r1 r2 h` creates a frustum. `r1` is the bottom radius, `r2` is the top radius, `h` is the height. Setting `r2` to 0 produces a full cone.

```
cone 10 5 20       # frustum (bottom R10, top R5, height 20)
cone 10 0 20       # full cone
```

`torus r1 r2` creates a donut shape. `r1` is the major radius (center to tube center), `r2` is the minor (tube) radius.

```
torus 20 5          # major radius 20, tube radius 5
```

`wedge dx dy dz ltx` creates a wedge (tapered box). The base is `dx` x `dz`, the top narrows to `ltx` x `dz`, and `dy` is the height.

```
wedge 20 10 15 5    # base 20x15, top 5x15, height 10
```

