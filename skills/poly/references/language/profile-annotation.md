# PolyScript language: @profile Annotation

> GENERATED from docs/content/en/language.md (@profile Annotation) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## @profile Annotation

Defines **presets** that switch several top-level variables at once; the GUI customizer shows them as a "Preset" dropdown. Independent of `@param`, and the two can be combined.

```
@profile {
  "S": { width: 30, height: 20, depth: 15 },
  "M": { width: 60, height: 40, depth: 30 },
  "L": { width: 120, height: 80, depth: 60 }
}

@param 10..200 step:5 desc:"Box width"
width = 60
height = 40
depth = 30

box width height depth
```

| Item | Rule |
|---|---|
| Placement and count | Top level, **at most one per file** (a second is a parse error) |
| Preset names | Double-quoted strings; a duplicate is a parse error |
| Values | Numbers, strings, booleans (no `null`). An empty body `@profile {}` is an error; an empty entry `"S": {}` is allowed (declared values unchanged) |
| Unknown variables | Warned and ignored |
| Initial GUI selection | The entry that matches the file's current values exactly, else "Custom"; editing a value so no entry matches also shows "Custom" |

