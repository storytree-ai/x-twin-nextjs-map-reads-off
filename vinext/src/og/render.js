// next/og's renderer: a React element tree to RGBA pixels. Like satori,
// every element is a flex container (row by default); this lays out the
// common subset (sizes, padding, margin, gap, flex direction/grow/shrink,
// justify/align, absolute position) and paints background colours, linear
// gradients, borders, border radius, opacity and text in the built-in
// bitmap font. Images, fonts, shadows and transforms are not drawn.
import { glyph, PIXEL_EM, ADVANCE_EM, LINE_HEIGHT_EM } from "./font.js";
import { parseColor, parseBackground } from "./color.js";

const FRAGMENT = Symbol.for("react.fragment");
const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");
const INHERITED = ["color", "fontSize", "fontWeight", "textAlign", "lineHeight", "letterSpacing", "textTransform"];
const DEFAULT_FONT_SIZE = 16;

// ---- element tree -> layout nodes ----

function inherit(style) {
  const out = {};
  for (const k of INHERITED) if (style[k] !== undefined) out[k] = style[k];
  return out;
}

function toNodes(child, inherited) {
  if (child == null || typeof child === "boolean") return [];
  if (typeof child === "string" || typeof child === "number" || typeof child === "bigint") {
    const text = String(child);
    return text ? [{ text, style: inherited }] : [];
  }
  if (Array.isArray(child)) return child.flatMap((c) => toNodes(c, inherited));
  if (typeof child !== "object" || !child.$$typeof) return [];
  const { type, props = {} } = child;
  if (typeof type === "function") {
    const out = type.prototype && type.prototype.render ? new type(props).render() : type(props);
    return toNodes(out, inherited);
  }
  if (type && type.$$typeof === MEMO) return toNodes({ ...child, type: type.type }, inherited);
  if (type && type.$$typeof === FORWARD_REF) return toNodes(type.render(props, null), inherited);
  if (typeof type !== "string") return type === FRAGMENT || typeof type === "symbol" ? toNodes(props.children, inherited) : [];
  const style = { ...inherited, ...(props.style || {}) };
  if (style.display === "none") return [];
  if (type === "img") {
    style.width ??= props.width;
    style.height ??= props.height;
  }
  return [{ tag: type, style, children: type === "img" ? [] : toNodes(props.children, inherit(style)) }];
}

// ---- lengths ----

const fontSizeOf = (style) => length(style.fontSize, DEFAULT_FONT_SIZE) ?? DEFAULT_FONT_SIZE;

/** A CSS length in px (percentages of `of`), or null for auto/unknown. */
function length(v, of, fontSize = DEFAULT_FONT_SIZE) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const m = /^(-?[\d.]+)(px|%|em|rem|pt|vw|vh)?$/.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "%":
      return Number.isFinite(of) ? (n * of) / 100 : null;
    case "em":
      return n * fontSize;
    case "rem":
      return n * DEFAULT_FONT_SIZE;
    case "pt":
      return (n * 4) / 3;
    default:
      return n;
  }
}

/** [top, right, bottom, left] of a padding/margin shorthand and its longhands. */
function sides(style, prop, of) {
  const fs = fontSizeOf(style);
  let vals = [0, 0, 0, 0];
  const short = style[prop];
  if (short !== undefined) {
    const parts = typeof short === "number" ? [short] : String(short).trim().split(/\s+/);
    const [t, r = t, b = t, l = r] = parts.map((p) => length(p, of, fs) ?? 0);
    vals = [t, r, b, l];
  }
  ["Top", "Right", "Bottom", "Left"].forEach((side, i) => {
    const v = style[prop + side];
    if (v !== undefined) vals[i] = length(v, of, fs) ?? 0;
  });
  return vals;
}

function borderWidth(style) {
  if (style.borderWidth !== undefined) return length(style.borderWidth, NaN) ?? 0;
  if (typeof style.border === "number") return style.border;
  if (typeof style.border === "string") {
    const w = style.border.split(/\s+/).map((p) => length(p, NaN)).find((n) => n != null);
    return w ?? 0;
  }
  return 0;
}

function borderColor(style) {
  if (style.borderColor) return style.borderColor;
  if (typeof style.border === "string") {
    const part = style.border.split(/\s+(?![^(]*\))/).find((p) => parseColor(p));
    if (part) return part;
  }
  return style.color || "black";
}

function lineHeightPx(style) {
  const fs = fontSizeOf(style);
  const lh = style.lineHeight;
  if (typeof lh === "number") return lh * fs;
  return length(lh, fs, fs) ?? fs * LINE_HEIGHT_EM;
}

// ---- text ----

function textMetrics(style) {
  const fs = fontSizeOf(style);
  const spacing = length(style.letterSpacing, fs, fs) ?? 0;
  return { fs, advance: fs * ADVANCE_EM + spacing, gap: fs * PIXEL_EM, lineHeight: lineHeightPx(style) };
}

function transform(text, style) {
  if (style.textTransform === "uppercase") return text.toUpperCase();
  if (style.textTransform === "lowercase") return text.toLowerCase();
  return text;
}

const lineWidth = (line, m) => (line.length ? line.length * m.advance - m.gap : 0);

/** The text's lines, wrapped at spaces to maxWidth. */
function wrap(text, style, maxWidth) {
  const m = textMetrics(style);
  const lines = [];
  for (const para of transform(text, style).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (line.trim() && /\S/.test(word) && lineWidth(next, m) > maxWidth + 0.01) {
        lines.push(line.trimEnd());
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---- layout ----

const isRow = (style) => !String(style.flexDirection || "row").startsWith("column");
const isAbsolute = (node) => node.style.position === "absolute";

function gaps(style, row) {
  const g = length(row ? style.columnGap ?? style.gap : style.rowGap ?? style.gap, NaN) ?? 0;
  return g;
}

function clamp(v, style, axis, of) {
  const min = length(style[axis === "w" ? "minWidth" : "minHeight"], of);
  const max = length(style[axis === "w" ? "maxWidth" : "maxHeight"], of);
  if (max != null) v = Math.min(v, max);
  if (min != null) v = Math.max(v, min);
  return v;
}

/** A node's border-box size when laid out in availW x availH (auto sizes shrink to content). */
function measure(node, availW, availH) {
  if (node.text !== undefined) {
    const m = textMetrics(node.style);
    const lines = wrap(node.text, node.style, Number.isFinite(availW) ? availW : Infinity);
    return { w: Math.max(0, ...lines.map((l) => lineWidth(l, m))), h: lines.length * m.lineHeight };
  }
  const { style } = node;
  const fs = fontSizeOf(style);
  const ownW = length(style.width, availW, fs);
  const ownH = length(style.height, availH, fs);
  const [pt, pr, pb, pl] = sides(style, "padding", availW);
  const bw = borderWidth(style);
  const innerW = (ownW ?? availW) - pl - pr - 2 * bw;
  const innerH = (ownH ?? availH) - pt - pb - 2 * bw;
  const row = isRow(style);
  const items = node.children.filter((c) => c.text !== undefined || !isAbsolute(c));
  let main = 0;
  let cross = 0;
  for (const item of items) {
    const s = measure(item, innerW, innerH);
    const [mt, mr, mb, ml] = item.text !== undefined ? [0, 0, 0, 0] : sides(item.style, "margin", innerW);
    main += row ? s.w + ml + mr : s.h + mt + mb;
    cross = Math.max(cross, row ? s.h + mt + mb : s.w + ml + mr);
  }
  main += Math.max(0, items.length - 1) * gaps(style, row);
  const contentW = row ? main : cross;
  const contentH = row ? cross : main;
  return {
    w: clamp(ownW ?? contentW + pl + pr + 2 * bw, style, "w", availW),
    h: clamp(ownH ?? contentH + pt + pb + 2 * bw, style, "h", availH),
  };
}

const JUSTIFY = {
  "flex-start": (free) => [0, 0],
  start: (free) => [0, 0],
  center: (free) => [free / 2, 0],
  "flex-end": (free) => [free, 0],
  end: (free) => [free, 0],
  "space-between": (free, n) => (n > 1 ? [0, free / (n - 1)] : [0, 0]),
  "space-around": (free, n) => [free / n / 2, free / n],
  "space-evenly": (free, n) => [free / (n + 1), free / (n + 1)],
};

/** Gives the node and its descendants their boxes: node.box = { x, y, w, h }. */
function place(node, x, y, w, h) {
  node.box = { x, y, w, h };
  if (node.text !== undefined) {
    node.lines = wrap(node.text, node.style, w);
    return;
  }
  const { style } = node;
  const [pt, pr, pb, pl] = sides(style, "padding", w);
  const bw = borderWidth(style);
  const ix = x + pl + bw;
  const iy = y + pt + bw;
  const iw = Math.max(0, w - pl - pr - 2 * bw);
  const ih = Math.max(0, h - pt - pb - 2 * bw);
  const row = isRow(style);
  const mainSize = row ? iw : ih;
  const crossSize = row ? ih : iw;
  const gap = gaps(style, row);

  const items = node.children
    .filter((c) => c.text !== undefined || !isAbsolute(c))
    .map((item) => {
      const s = measure(item, iw, ih);
      const st = item.text !== undefined ? {} : item.style;
      const [mt, mr, mb, ml] = item.text !== undefined ? [0, 0, 0, 0] : sides(st, "margin", iw);
      return {
        item,
        st,
        main: row ? s.w : s.h,
        cross: row ? s.h : s.w,
        mBefore: row ? ml : mt,
        mAfter: row ? mr : mb,
        cBefore: row ? mt : ml,
        cAfter: row ? mb : mr,
      };
    });

  let free = mainSize - items.reduce((sum, i) => sum + i.main + i.mBefore + i.mAfter, 0) - gap * Math.max(0, items.length - 1);
  const grow = items.reduce((sum, i) => sum + (Number(i.st.flexGrow ?? i.st.flex) || 0), 0);
  if (free > 0 && grow > 0) {
    for (const i of items) i.main += (free * (Number(i.st.flexGrow ?? i.st.flex) || 0)) / grow;
    free = 0;
  } else if (free < 0) {
    const weight = items.reduce((sum, i) => sum + Number(i.st.flexShrink ?? 1) * i.main, 0);
    if (weight > 0) for (const i of items) i.main = Math.max(0, i.main + (free * Number(i.st.flexShrink ?? 1) * i.main) / weight);
    free = 0;
  }

  const [start, between] = (JUSTIFY[style.justifyContent] || JUSTIFY["flex-start"])(Math.max(0, free), items.length);
  let pos = start;
  for (const i of items) {
    const align = i.st.alignSelf && i.st.alignSelf !== "auto" ? i.st.alignSelf : style.alignItems || "stretch";
    const ownCross = i.item.text === undefined && length(row ? i.st.height : i.st.width, crossSize) != null;
    const room = crossSize - i.cBefore - i.cAfter;
    if (align === "stretch" && !ownCross) i.cross = room;
    let c = i.cBefore;
    if (align === "center") c += (room - i.cross) / 2;
    else if (align === "flex-end" || align === "end") c += room - i.cross;
    pos += i.mBefore;
    if (row) place(i.item, ix + pos, iy + c, i.main, i.cross);
    else place(i.item, ix + c, iy + pos, i.cross, i.main);
    pos += i.main + i.mAfter + gap + between;
  }

  for (const child of node.children) {
    if (child.text !== undefined || !isAbsolute(child)) continue;
    const st = child.style;
    const padW = iw + pl + pr;
    const padH = ih + pt + pb;
    const left = length(st.left, padW);
    const right = length(st.right, padW);
    const top = length(st.top, padH);
    const bottom = length(st.bottom, padH);
    const s = measure(child, padW, padH);
    const cw = length(st.width, padW) == null && left != null && right != null ? padW - left - right : s.w;
    const ch = length(st.height, padH) == null && top != null && bottom != null ? padH - top - bottom : s.h;
    const cx = left != null ? left : right != null ? padW - right - cw : pl;
    const cy = top != null ? top : bottom != null ? padH - bottom - ch : pt;
    place(child, x + bw + cx, y + bw + cy, cw, ch);
  }
}

// ---- painting ----

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = new Float32Array(width * height * 4);
  }

  /** Composites colour [r, g, b, a] (0..1) over pixel x, y with coverage. */
  blend(x, y, [r, g, b, a], coverage) {
    const sa = a * coverage;
    if (sa <= 0) return;
    const o = (y * this.width + x) * 4;
    const p = this.px;
    const da = p[o + 3];
    const oa = sa + da * (1 - sa);
    p[o] = (r * sa + p[o] * da * (1 - sa)) / oa;
    p[o + 1] = (g * sa + p[o + 1] * da * (1 - sa)) / oa;
    p[o + 2] = (b * sa + p[o + 2] * da * (1 - sa)) / oa;
    p[o + 3] = oa;
  }

  /** Fills the rectangle (fractional edges antialiased) with paint(x, y) -> colour. */
  fillRect(x0, y0, x1, y1, paint, radius = 0, alpha = 1) {
    const top = Math.max(0, Math.floor(y0));
    const bottom = Math.min(this.height, Math.ceil(y1));
    const left = Math.max(0, Math.floor(x0));
    const right = Math.min(this.width, Math.ceil(x1));
    const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
    for (let y = top; y < bottom; y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0);
      if (cy <= 0) continue;
      for (let x = left; x < right; x++) {
        let cov = Math.min(1, Math.min(x + 1, x1) - Math.max(x, x0)) * Math.min(1, cy);
        if (cov <= 0) continue;
        if (r > 0) {
          const px = x + 0.5;
          const py = y + 0.5;
          const ccx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px;
          const ccy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py;
          if (ccx !== px && ccy !== py) cov = Math.min(cov, Math.max(0, Math.min(1, r - Math.hypot(px - ccx, py - ccy) + 0.5)));
        }
        this.blend(x, y, paint(x + 0.5, y + 0.5), cov * alpha);
      }
    }
  }

  rgba() {
    const out = new Uint8Array(this.px.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, this.px[i])) * 255);
    return out;
  }
}

function radiusOf(style, w, h) {
  const v = style.borderRadius;
  if (v === undefined) return 0;
  const first = typeof v === "string" ? v.trim().split(/\s+/)[0] : v;
  return length(first, Math.min(w, h)) ?? 0;
}

function paint(node, canvas, opacity) {
  const { x, y, w, h } = node.box;
  const { style } = node;
  if (node.text !== undefined) {
    paintText(node, canvas, opacity);
    return;
  }
  const alpha = opacity * (style.opacity !== undefined ? Number(style.opacity) : 1);
  const r = radiusOf(style, w, h);
  const bw = borderWidth(style);
  const color = (c) => parseColor(c, style.color);
  if (bw > 0) {
    const bc = color(borderColor(style));
    if (bc) {
      // The ring: the outer box, then the inner box punched back out below it.
      canvas.fillRect(x, y, x + bw, y + h, () => bc, 0, alpha);
      canvas.fillRect(x + w - bw, y, x + w, y + h, () => bc, 0, alpha);
      canvas.fillRect(x + bw, y, x + w - bw, y + bw, () => bc, 0, alpha);
      canvas.fillRect(x + bw, y + h - bw, x + w - bw, y + h, () => bc, 0, alpha);
    }
  }
  for (const layer of [style.backgroundColor, style.background, style.backgroundImage]) {
    const fill = layer && parseBackground(layer, style.color);
    if (fill) canvas.fillRect(x + bw, y + bw, x + w - bw, y + h - bw, fill(x + bw, y + bw, w - 2 * bw, h - 2 * bw), Math.max(0, r - bw), alpha);
  }
  for (const child of node.children) paint(child, canvas, alpha);
}

function paintText(node, canvas, opacity) {
  const { style } = node;
  const colour = parseColor(style.color || "black");
  if (!colour) return;
  const m = textMetrics(style);
  const p = m.fs * PIXEL_EM;
  const bold = Number(style.fontWeight) >= 600 || style.fontWeight === "bold" ? p / 2 : 0;
  const { x, y, w } = node.box;
  // Large glyph cells snap to whole pixels, so neighbouring cells meet without seams.
  const snap = p >= 2 ? Math.round : (v) => v;
  node.lines.forEach((line, i) => {
    const lw = lineWidth(line, m);
    let lx = x;
    if (style.textAlign === "center") lx += (w - lw) / 2;
    else if (style.textAlign === "right" || style.textAlign === "end") lx += w - lw;
    const ly = y + i * m.lineHeight + (m.lineHeight - 7 * p) / 2;
    [...line].forEach((ch, k) => {
      const cols = glyph(ch);
      const gx = lx + k * m.advance;
      for (let c = 0; c < 5; c++) {
        for (let row = 0; row < 7; row++) {
          if (!(cols[c] & (1 << row))) continue;
          const x0 = snap(gx + c * p);
          const y0 = snap(ly + row * p);
          canvas.fillRect(x0, y0, snap(gx + (c + 1) * p + bold), snap(ly + (row + 1) * p), () => colour, 0, opacity);
        }
      }
    });
  });
}

/** RGBA bytes of the element drawn at width x height. */
export function renderToPixels(element, width, height) {
  const root = { tag: "div", style: { width, height, display: "flex" }, children: toNodes(element, {}) };
  place(root, 0, 0, width, height);
  const canvas = new Canvas(width, height);
  paint(root, canvas, 1);
  return canvas.rgba();
}
