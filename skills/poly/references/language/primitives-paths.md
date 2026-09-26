# PolyScript language: Primitives

> GENERATED from docs/content/en/language.md (Primitives > Paths) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Primitives

### Paths

```
line start end
arc start through end
arc start end center:(cx,cy)
arc start end radius:radius
bezier points
helix pitch height radius
spline points
```

`spline` creates a smooth B-spline curve that **passes through** the specified points. It can be used as the spine of `sweep`.

`bezier` treats the specified points as **control points**. The curve passes near the control points but does not go through any of them except the start and end points. If you need a smooth curve that passes exactly through your points, use `spline`.

```
spline [(0,0,0), (10,5,5), (20,0,10)] | sweep (circle 3)
```

> **Note**: The list convention for `bezier`/`spline` differs by context. As standalone commands (`bezier [...] | sweep`, etc.), the list includes the start point as its first element. Inside `sketch`/`wire` segments, however, the start point is implicitly inherited from the preceding segment's endpoint (the current point), so the list contains only the control/through-points and the end point. This follows the industry-standard convention used by CadQuery and SVG paths.


