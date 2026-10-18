// CSS colours and backgrounds for next/og: colours as [r, g, b, a] in 0..1,
// backgrounds as fills (box -> (x, y) -> colour).

const NAMED = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  lime: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  purple: "#800080",
  teal: "#008080",
  navy: "#000080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  gold: "#ffd700",
  indigo: "#4b0082",
  violet: "#ee82ee",
  coral: "#ff7f50",
  salmon: "#fa8072",
  tomato: "#ff6347",
  crimson: "#dc143c",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  whitesmoke: "#f5f5f5",
  transparent: "#00000000",
};

function hex(s) {
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
}

function channel(v, scale) {
  return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v) / scale;
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** [r, g, b, a] of a CSS colour, or null. currentColor resolves to `current`. */
export function parseColor(value, current = "black") {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s === "currentcolor") return current && current.toLowerCase() !== "currentcolor" ? parseColor(current) : null;
  if (NAMED[s]) return hex(NAMED[s]);
  if (s.startsWith("#")) return hex(s);
  const m = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] !== undefined ? channel(parts[3], 1) : 1;
  if (m[1].startsWith("rgb")) return [channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255), alpha];
  return [...hsl(parseFloat(parts[0]), channel(parts[1], 100), channel(parts[2], 100)), alpha];
}

/** The top-level comma-separated arguments of a CSS function's argument list. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SIDES = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** The gradient's direction as a unit vector, for a w x h box. */
function direction(arg, w, h) {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(arg);
  if (m) {
    const n = parseFloat(m[1]);
    const deg = m[2] === "turn" ? n * 360 : m[2] === "rad" ? (n * 180) / Math.PI : m[2] === "grad" ? n * 0.9 : n;
    const a = (deg * Math.PI) / 180;
    return [Math.sin(a), -Math.cos(a)];
  }
  let dx = 0;
  let dy = 0;
  for (const word of arg.replace(/^to\s+/, "").split(/\s+/)) {
    const [sx, sy] = SIDES[word] || [0, 0];
    dx += sx * h;
    dy += sy * w;
  }
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function linearGradient(args) {
  let dirArg = "180deg";
  if (/^(to\s|-?[\d.]+(deg|turn|rad|grad)$)/.test(args[0])) dirArg = args.shift();
  const stops = [];
  for (const a of args) {
    const m = /^(.*?)\s+(-?[\d.]+%)$/.exec(a);
    const color = parseColor(m ? m[1] : a);
    if (color) stops.push({ color, at: m ? parseFloat(m[2]) / 100 : null });
  }
  if (!stops.length) return null;
  stops.forEach((s, i) => {
    if (s.at == null) s.at = stops.length === 1 ? 0 : i / (stops.length - 1);
    if (i > 0) s.at = Math.max(s.at, stops[i - 1].at);
  });
  return (bx, by, w, h) => {
    const [dx, dy] = direction(dirArg, w, h);
    const len = Math.abs(w * dx) + Math.abs(h * dy) || 1;
    const cx = bx + w / 2;
    const cy = by + h / 2;
    return (x, y) => {
      const t = ((x - cx) * dx + (y - cy) * dy) / len + 0.5;
      if (t <= stops[0].at) return stops[0].color;
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (t <= b.at) {
          const f = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
          return a.color.map((v, k) => v + (b.color[k] - v) * f);
        }
      }
      return stops[stops.length - 1].color;
    };
  };
}

/**
 * The fill for a CSS background value — (x, y, w, h) of the box ->
 * (px, py) -> colour — or null when it draws nothing here. Radial and
 * conic gradients fill with their first colour.
 */
export function parseBackground(value, current) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(s);
  if (m) {
    const args = splitArgs(m[3]);
    if (m[2] === "linear") return linearGradient(args);
    const first = args.map((a) => parseColor(a.replace(/\s+-?[\d.]+%$/, ""), current)).find(Boolean);
    return first ? () => () => first : null;
  }
  const color = parseColor(s, current);
  return color && color[3] > 0 ? () => () => color : null;
}
