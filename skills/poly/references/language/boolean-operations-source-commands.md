# PolyScript language: Boolean Operations

> GENERATED from docs/content/en/language.md (Boolean Operations (Source Commands)) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Boolean Operations (Source Commands)

`union`, `diff`, and `inter` can be used as source commands (without a pipe) to combine multiple shapes:

```
union [box 10 10 10, sphere 7]     # combine shapes
diff [box 10 10 10, sphere 7]      # subtract second from first
inter [box 10 10 10, sphere 7]     # keep only the intersection
```

They also work as pipe operations, as before:

```
box 10 10 10 | union (sphere 7)
box 10 10 10 | diff (cylinder 3 20)
```

Note: `[]` is always a list literal. To combine shapes, use `union [...]` explicitly. Inside expressions the shape operators `a + b` / `a - b` / `a * b` are available too (see "Shape operators").

