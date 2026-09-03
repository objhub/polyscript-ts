/**
 * PolyScript color utilities.
 *
 * Provides named color palette (CSS Named Colors + CAD material colors),
 * HEX parser, RGB normalizer, and a unified resolveColor() function.
 */

// ---------------------------------------------------------------------------
// Tier 1: Basic 16 colors
// ---------------------------------------------------------------------------

const TIER1: Record<string, [number, number, number]> = {
  red:     [1, 0, 0],
  green:   [0, 128/255, 0],
  blue:    [0, 0, 1],
  yellow:  [1, 1, 0],
  cyan:    [0, 1, 1],
  magenta: [1, 0, 1],
  orange:  [1, 165/255, 0],
  purple:  [128/255, 0, 128/255],
  white:   [1, 1, 1],
  black:   [0, 0, 0],
  gray:    [128/255, 128/255, 128/255],
  grey:    [128/255, 128/255, 128/255],
  brown:   [139/255, 69/255, 19/255],
  pink:    [1, 192/255, 203/255],
  lime:    [0, 1, 0],
  navy:    [0, 0, 128/255],
  teal:    [0, 128/255, 128/255],
};

// ---------------------------------------------------------------------------
// Tier 2: CAD material colors
// ---------------------------------------------------------------------------

const TIER2: Record<string, [number, number, number]> = {
  silver:    [192/255, 192/255, 192/255],
  gold:      [1, 215/255, 0],
  steel:     [113/255, 121/255, 126/255],
  copper:    [184/255, 115/255, 51/255],
  brass:     [181/255, 166/255, 66/255],
  aluminum:  [168/255, 169/255, 173/255],
  darkgray:  [64/255, 64/255, 64/255],
  darkgrey:  [64/255, 64/255, 64/255],
  lightgray: [211/255, 211/255, 211/255],
  lightgrey: [211/255, 211/255, 211/255],
};

// ---------------------------------------------------------------------------
// Tier 3: CSS Named Colors (those not already in Tier 1/2)
// ---------------------------------------------------------------------------

const TIER3: Record<string, [number, number, number]> = {
  aliceblue:            [240/255, 248/255, 1],
  antiquewhite:         [250/255, 235/255, 215/255],
  aqua:                 [0, 1, 1],
  aquamarine:           [127/255, 1, 212/255],
  azure:                [240/255, 1, 1],
  beige:                [245/255, 245/255, 220/255],
  bisque:               [1, 228/255, 196/255],
  blanchedalmond:       [1, 235/255, 205/255],
  blueviolet:           [138/255, 43/255, 226/255],
  burlywood:            [222/255, 184/255, 135/255],
  cadetblue:            [95/255, 158/255, 160/255],
  chartreuse:           [127/255, 1, 0],
  chocolate:            [210/255, 105/255, 30/255],
  coral:                [1, 127/255, 80/255],
  cornflowerblue:       [100/255, 149/255, 237/255],
  cornsilk:             [1, 248/255, 220/255],
  crimson:              [220/255, 20/255, 60/255],
  darkblue:             [0, 0, 139/255],
  darkcyan:             [0, 139/255, 139/255],
  darkgoldenrod:        [184/255, 134/255, 11/255],
  darkgreen:            [0, 100/255, 0],
  darkkhaki:            [189/255, 183/255, 107/255],
  darkmagenta:          [139/255, 0, 139/255],
  darkolivegreen:       [85/255, 107/255, 47/255],
  darkorange:           [1, 140/255, 0],
  darkorchid:           [153/255, 50/255, 204/255],
  darkred:              [139/255, 0, 0],
  darksalmon:           [233/255, 150/255, 122/255],
  darkseagreen:         [143/255, 188/255, 143/255],
  darkslateblue:        [72/255, 61/255, 139/255],
  darkslategray:        [47/255, 79/255, 79/255],
  darkslategrey:        [47/255, 79/255, 79/255],
  darkturquoise:        [0, 206/255, 209/255],
  darkviolet:           [148/255, 0, 211/255],
  deeppink:             [1, 20/255, 147/255],
  deepskyblue:          [0, 191/255, 1],
  dimgray:              [105/255, 105/255, 105/255],
  dimgrey:              [105/255, 105/255, 105/255],
  dodgerblue:           [30/255, 144/255, 1],
  firebrick:            [178/255, 34/255, 34/255],
  floralwhite:          [1, 250/255, 240/255],
  forestgreen:          [34/255, 139/255, 34/255],
  fuchsia:              [1, 0, 1],
  gainsboro:            [220/255, 220/255, 220/255],
  ghostwhite:           [248/255, 248/255, 1],
  goldenrod:            [218/255, 165/255, 32/255],
  greenyellow:          [173/255, 1, 47/255],
  honeydew:             [240/255, 1, 240/255],
  hotpink:              [1, 105/255, 180/255],
  indianred:            [205/255, 92/255, 92/255],
  indigo:               [75/255, 0, 130/255],
  ivory:                [1, 1, 240/255],
  khaki:                [240/255, 230/255, 140/255],
  lavender:             [230/255, 230/255, 250/255],
  lavenderblush:        [1, 240/255, 245/255],
  lawngreen:            [124/255, 252/255, 0],
  lemonchiffon:         [1, 250/255, 205/255],
  lightblue:            [173/255, 216/255, 230/255],
  lightcoral:           [240/255, 128/255, 128/255],
  lightcyan:            [224/255, 1, 1],
  lightgoldenrodyellow: [250/255, 250/255, 210/255],
  lightgreen:           [144/255, 238/255, 144/255],
  lightpink:            [1, 182/255, 193/255],
  lightsalmon:          [1, 160/255, 122/255],
  lightseagreen:        [32/255, 178/255, 170/255],
  lightskyblue:         [135/255, 206/255, 250/255],
  lightslategray:       [119/255, 136/255, 153/255],
  lightslategrey:       [119/255, 136/255, 153/255],
  lightsteelblue:       [176/255, 196/255, 222/255],
  lightyellow:          [1, 1, 224/255],
  limegreen:            [50/255, 205/255, 50/255],
  linen:                [250/255, 240/255, 230/255],
  maroon:               [128/255, 0, 0],
  mediumaquamarine:     [102/255, 205/255, 170/255],
  mediumblue:           [0, 0, 205/255],
  mediumorchid:         [186/255, 85/255, 211/255],
  mediumpurple:         [147/255, 112/255, 219/255],
  mediumseagreen:       [60/255, 179/255, 113/255],
  mediumslateblue:      [123/255, 104/255, 238/255],
  mediumspringgreen:    [0, 250/255, 154/255],
  mediumturquoise:      [72/255, 209/255, 204/255],
  mediumvioletred:      [199/255, 21/255, 133/255],
  midnightblue:         [25/255, 25/255, 112/255],
  mintcream:            [245/255, 1, 250/255],
  mistyrose:            [1, 228/255, 225/255],
  moccasin:             [1, 228/255, 181/255],
  navajowhite:          [1, 222/255, 173/255],
  oldlace:              [253/255, 245/255, 230/255],
  olive:                [128/255, 128/255, 0],
  olivedrab:            [107/255, 142/255, 35/255],
  orangered:            [1, 69/255, 0],
  orchid:               [218/255, 112/255, 214/255],
  palegoldenrod:        [238/255, 232/255, 170/255],
  palegreen:            [152/255, 251/255, 152/255],
  paleturquoise:        [175/255, 238/255, 238/255],
  palevioletred:        [219/255, 112/255, 147/255],
  papayawhip:           [1, 239/255, 213/255],
  peachpuff:            [1, 218/255, 185/255],
  peru:                 [205/255, 133/255, 63/255],
  plum:                 [221/255, 160/255, 221/255],
  powderblue:           [176/255, 224/255, 230/255],
  rosybrown:            [188/255, 143/255, 143/255],
  royalblue:            [65/255, 105/255, 225/255],
  saddlebrown:          [139/255, 69/255, 19/255],
  salmon:               [250/255, 128/255, 114/255],
  sandybrown:           [244/255, 164/255, 96/255],
  seagreen:             [46/255, 139/255, 87/255],
  seashell:             [1, 245/255, 238/255],
  sienna:               [160/255, 82/255, 45/255],
  skyblue:              [135/255, 206/255, 235/255],
  slateblue:            [106/255, 90/255, 205/255],
  slategray:            [112/255, 128/255, 144/255],
  slategrey:            [112/255, 128/255, 144/255],
  snow:                 [1, 250/255, 250/255],
  springgreen:          [0, 1, 127/255],
  steelblue:            [70/255, 130/255, 180/255],
  tan:                  [210/255, 180/255, 140/255],
  thistle:              [216/255, 191/255, 216/255],
  tomato:               [1, 99/255, 71/255],
  turquoise:            [64/255, 224/255, 208/255],
  violet:               [238/255, 130/255, 238/255],
  wheat:                [245/255, 222/255, 179/255],
  whitesmoke:           [245/255, 245/255, 245/255],
  yellowgreen:          [154/255, 205/255, 50/255],
};

// ---------------------------------------------------------------------------
// Merged palette
// ---------------------------------------------------------------------------

export const NAMED_COLORS: Record<string, [number, number, number]> = {
  ...TIER3,
  ...TIER2,
  ...TIER1, // Tier 1 wins on overlap
};

// ---------------------------------------------------------------------------
// HEX parser
// ---------------------------------------------------------------------------

/**
 * Parse a HEX color string to RGB 0..1.
 * Supports "#RRGGBB" and "#RGB" shorthand.
 * Returns null if the string is not a valid HEX color.
 */
export function parseHexColor(hex: string): [number, number, number] | null {
  if (!hex.startsWith('#')) return null;
  const h = hex.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r / 255, g / 255, b / 255];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r / 255, g / 255, b / 255];
  }
  return null;
}

// ---------------------------------------------------------------------------
// RGB normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize RGB values. If all values are <= 1, they are treated as 0..1 range.
 * If any value exceeds 1, all are treated as 0..255 and divided by 255.
 */
export function normalizeRGB(r: number, g: number, b: number): [number, number, number] {
  if (r > 1 || g > 1 || b > 1) {
    return [r / 255, g / 255, b / 255];
  }
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// Unified color resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a color specification to RGB 0..1.
 * Accepts a named color string, a HEX string, or an RGB triple.
 * Throws on unknown color name.
 */
export function resolveColor(spec: string | [number, number, number]): [number, number, number] {
  if (typeof spec === 'string') {
    // HEX color
    const hex = parseHexColor(spec);
    if (hex) return hex;

    // Named color (case-insensitive)
    const lower = spec.toLowerCase();
    if (lower in NAMED_COLORS) return NAMED_COLORS[lower];

    throw new Error(`Unknown color name: "${spec}"`);
  }

  // RGB triple
  return normalizeRGB(spec[0], spec[1], spec[2]);
}
