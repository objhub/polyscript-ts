# PolyScript language: Pipe Operations

> GENERATED from docs/content/en/language.md (Pipe Operations > Color) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Pipe Operations

### Color

Apply color to a shape. Colors are reflected per-part on export (glTF/GLB/STEP/OFF).

```
| color "red"                    # named color
| color "#FF0000"                # hex color (string literal)
| color "#F00"                   # hex shorthand
| color 0.8 0.2 0.1             # RGB float (0..1)
| color 255 128 0               # RGB int (0..255, auto-normalized)
| color "red" alpha:0.5         # with transparency
```

There are three ways to specify colors:

- **Named colors**: `"red"`, `"blue"`, `"steel"`, etc.
- **Hex colors**: `"#FF0000"` or shorthand `"#F00"` (must be written as a string literal since `#` is the comment character)
- **RGB values**: Three numbers. If all are 1 or below, they are treated as 0..1 range; if any exceeds 1, they are auto-normalized as 0..255 range

The `alpha:` keyword argument sets transparency (0..1, default 1.0).

You can also assign different colors to individual parts:

```
union [
  box 10 10 10 | color "red"
  cylinder 15 3 | color "blue"
]
```

#### Named color palette

Three tiers of color names are available:

| Tier | Color names |
|---|---|
| Basic (16 colors) | `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`, `orange`, `purple`, `white`, `black`, `gray`/`grey`, `brown`, `pink`, `lime`, `navy`, `teal` |
| CAD material colors | `silver`, `gold`, `steel`, `copper`, `brass`, `aluminum`, `darkgray`/`darkgrey`, `lightgray`/`lightgrey` |
| CSS Named Colors | `steelblue`, `coral`, `darkslategray`, and all other CSS-compliant color names |

An unknown color name will produce an error.

