// Color math for the contrast test, calibrated against Chromium
// (color-helper.test.mjs). Colors are { r, g, b, a } in sRGB, 0..1; mixes
// may leave r/g/b slightly outside 0..1 (out of gamut) until they are
// composited or measured, as in a browser.
import { cssRules, declarations, selectors } from "./css-rules.mjs";

export function parseColor(text) {
  const value = String(text).trim().toLowerCase();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (!hex) throw new Error("unsupported color: " + text);
  const digits =
    hex.length <= 4 ? [...hex].map((c) => c + c) : hex.match(/../g);
  const [r, g, b, a = 255] = digits.map((d) => parseInt(d, 16));
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

const clamp = (c) => Math.min(1, Math.max(0, c));
// sRGB transfer, extended to negative values as in CSS Color 4.
const toLinear = (c) => {
  const x = Math.abs(c);
  return (
    Math.sign(c) * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  );
};
const toGamma = (c) => {
  const x = Math.abs(c);
  return (
    Math.sign(c) * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055)
  );
};

function toOklab({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGamma);
}

const SPACES = {
  srgb: { to: ({ r, g, b }) => [r, g, b], from: (c) => c },
  oklab: { to: toOklab, from: fromOklab },
};

// CSS color-mix(in <space>, a pa%, b pb%): percentages in 0..100, either may
// be omitted; they are scaled to a sum of 100, and a sum below 100 also
// multiplies the alpha. Interpolation uses premultiplied alpha.
export function mix(space, a, pa, b, pb) {
  const s = SPACES[space];
  if (!s) throw new Error("unsupported color space: " + space);
  if (pa === undefined && pb === undefined) pa = pb = 50;
  else if (pa === undefined) pa = 100 - pb;
  else if (pb === undefined) pb = 100 - pa;
  for (const p of [pa, pb])
    if (!(p >= 0 && p <= 100)) throw new Error("invalid percentage: " + p);
  const sum = pa + pb;
  if (sum === 0) throw new Error("color-mix percentages sum to 0");
  const [wa, wb] = [pa / sum, pb / sum];
  const alpha = a.a * wa + b.a * wb;
  const [ca, cb] = [s.to(a), s.to(b)];
  const coords = ca.map((c, i) =>
    alpha === 0 ? 0 : (c * a.a * wa + cb[i] * b.a * wb) / alpha,
  );
  const [r, g, bl] = s.from(coords);
  return { r, g, b: bl, a: alpha * Math.min(1, sum / 100) };
}

// Source-over compositing in sRGB, as browsers paint.
export function over(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  const channel = (k) =>
    a === 0
      ? 0
      : (clamp(top[k]) * top.a + clamp(bottom[k]) * bottom.a * (1 - top.a)) / a;
  return { r: channel("r"), g: channel("g"), b: channel("b"), a };
}

const luminance = (c) => {
  const [r, g, b] = [c.r, c.g, c.b].map((x) => toLinear(clamp(x)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// WCAG 2.x contrast ratio. The background must be opaque; a translucent
// foreground is composited over it first.
export function contrast(fg, bg) {
  if (Math.abs(bg.a - 1) > 1e-9) throw new Error("background is not opaque");
  const front = fg.a < 1 ? over(fg, bg) : fg;
  const [x, y] = [luminance(front), luminance(bg)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Splits at top-level separators (outside parentheses).
function splitTop(text, separator) {
  const out = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (!depth && separator.test(c)) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

// "fn(inner)" spanning the whole text → inner, else undefined.
function call(text, fn) {
  if (!text.startsWith(fn + "(") || !text.endsWith(")")) return undefined;
  let depth = 0;
  for (let i = fn.length; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0)
      return i === text.length - 1 ? text.slice(fn.length + 1, -1) : undefined;
  }
  return undefined;
}

// The root element's state: one compound of :root and [attr] / [attr="value"]
// is understood; anything else (also a descendant or other combinator) is an
// error so a new selector cannot slip by.
function selectorWeight(selector, attributes) {
  const parts = selector.match(/:root|\[[\w-]+(?:="[^"]*")?\]/g) ?? [];
  if (parts.join("") !== selector.trim())
    throw new Error("unsupported selector: " + selector);
  for (const part of parts) {
    if (part === ":root") continue;
    const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
    if (!(name in attributes)) return -1;
    if (value !== undefined && attributes[name] !== value) return -1;
  }
  return parts.length;
}

// CSS named colors (CSS Color 4) and other color keywords.
const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
  deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
  honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
  lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
  limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
  mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
  peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
  saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle
  tomato turquoise violet wheat white whitesmoke yellow yellowgreen
  transparent currentcolor canvas canvastext`.split(/\s+/),
);
const COLOR_FUNCTION =
  /(?<![\w-])(?:color-mix|color|rgba?|hsla?|hwb|lab|lch|oklab|oklch|light-dark)\(/i;

// Whether a declaration value holds a color.
function holdsColor(value) {
  const text = value.replace(/var\(\s*--[\w-]+/g, "var(");
  if (COLOR_FUNCTION.test(text) || /#[0-9a-f]{3,8}\b/i.test(text)) return true;
  return (text.match(/(?<![\w-])[a-z]+(?![\w(-])/gi) ?? []).some((word) =>
    NAMED_COLORS.has(word.toLowerCase()),
  );
}

// Resolves the custom properties of a token sheet on the root element in a
// given palette mode: rules apply by selector, then win by specificity and
// source order. Rules inside at-rules (media queries) are left out, so they
// may hold geometry only: a color value there throws at once, and reading a
// token they declare throws on use. The palette and status keys act as
// inline styles.
export function resolveTokens(cssText, { palette, status, mode, band }) {
  const attributes = { "data-theme": mode, "data-band": band };
  const winners = new Map();
  const conditional = new Map();
  let order = 0;
  for (const rule of cssRules(cssText)) {
    if (rule.context.some((header) => !header.startsWith("@")))
      throw new Error("unsupported nested rule: " + rule.header);
    const weights = selectors(rule.header).map((s) =>
      selectorWeight(s, attributes),
    );
    const weight = Math.max(...weights);
    if (rule.context.length) {
      const where = rule.context.join(" ");
      for (const { name, value } of declarations(rule.body)) {
        if (holdsColor(value))
          throw new Error(`color inside ${where}: ${name}: ${value}`);
        if (name.startsWith("--")) conditional.set(name, where);
      }
      continue;
    }
    if (weight < 0) continue;
    for (const { name, value } of declarations(rule.body)) {
      if (!name.startsWith("--")) continue;
      const rank = [weight, order++];
      const prev = winners.get(name);
      if (!prev || rank[0] >= prev.rank[0]) winners.set(name, { value, rank });
    }
  }
  const inline = new Map([
    ...Object.entries(palette).map(([k, v]) => ["--" + k, v]),
    ...Object.entries(status).map(([k, v]) => ["--status-" + k, v]),
  ]);
  const raw = (name) => inline.get(name) ?? winners.get(name)?.value;

  function term(text, stack) {
    text = text.trim();
    const v = call(text, "var");
    if (v !== undefined) {
      const [name, ...rest] = splitTop(v, /,/);
      const fallback = rest.length ? v.slice(v.indexOf(",") + 1) : undefined;
      if (stack.includes(name))
        throw new Error("cycle: " + [...stack, name].join(" → "));
      if (conditional.has(name))
        throw new Error(
          `${name} is also declared inside ${conditional.get(name)}`,
        );
      const value = raw(name);
      if (value !== undefined) return term(value, [...stack, name]);
      if (fallback !== undefined) return term(fallback, stack);
      throw new Error(name + " is not defined");
    }
    const m = call(text, "color-mix");
    if (m !== undefined) {
      const [method, ...sides] = splitTop(m, /,/);
      const space = /^in\s+(\S+)$/.exec(method)?.[1];
      if (!space || sides.length !== 2)
        throw new Error("unsupported color-mix: " + text);
      const [[a, pa], [b, pb]] = sides.map((side) => {
        let color, percent;
        for (const part of splitTop(side, /\s/)) {
          const value = term(part, stack);
          if ("percent" in value && percent === undefined)
            percent = value.percent;
          else if ("r" in value && color === undefined) color = value;
          else throw new Error("unsupported color-mix side: " + side);
        }
        if (!color) throw new Error("color-mix side without color: " + side);
        return [color, percent];
      });
      return mix(space, a, pa, b, pb);
    }
    const percent = /^(\d+(?:\.\d+)?)%$/.exec(text);
    if (percent) return { percent: Number(percent[1]) };
    return parseColor(text);
  }

  const color = (nameOrExpression) => {
    const text = /^--[\w-]+$/.test(nameOrExpression)
      ? `var(${nameOrExpression})`
      : nameOrExpression;
    const value = term(text, []);
    if (!("r" in value)) throw new Error(nameOrExpression + " is not a color");
    return value;
  };

  // The color stops of each layer of a gradient token, in order.
  const stops = (name) => {
    if (conditional.has(name))
      throw new Error(
        `${name} is also declared inside ${conditional.get(name)}`,
      );
    const value = raw(name);
    if (value === undefined) throw new Error(name + " is not defined");
    return splitTop(value, /,/).map((layer) => {
      const fn = /^(linear|radial)-gradient\(/.exec(layer)?.[0].slice(0, -1);
      const inner = fn && call(layer, fn);
      if (inner === undefined)
        throw new Error(name + " is not a gradient: " + layer);
      return splitTop(inner, /,/)
        .filter(
          (arg, i) => i > 0 || /^(#|var\(|color-mix\(|transparent\b)/.test(arg),
        )
        .map((arg) => color(splitTop(arg, /\s/)[0]));
    });
  };

  return { color, stops };
}
