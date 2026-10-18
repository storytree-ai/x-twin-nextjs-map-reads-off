// CommonJS in app source (pages/cjs, components): `require("x")` becomes a
// hoisted `import * as` read through an interop helper, and a module that
// assigns module.exports (with no ES exports of its own) exports it as
// default. Applies to the app's own files; node_modules go through Vite.

const INTEROP = "__vinext_cjs_interop";
export const CJS_HELPER_ID = "vinext/cjs-interop";

/** module.exports for a CommonJS module, the namespace for an ES module. */
export function __vinext_cjs_interop(ns) {
  return ns && ns.__vinext_cjs ? ns.default : ns;
}

/** [start, end) ranges of comments, strings and templates: text, not code. */
function textRanges(code) {
  const ranges = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      ranges.push([i, stop]);
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      ranges.push([i, stop]);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      const start = i++;
      while (i < code.length && code[i] !== c) i += code[i] === "\\" ? 2 : 1;
      i++;
      ranges.push([start, i]);
    } else {
      i++;
    }
  }
  return ranges;
}

const inRanges = (ranges, pos) => ranges.some(([s, e]) => pos >= s && pos < e);

/** The transformed code, or null when the module has no CommonJS in it. */
export function transformCjs(code) {
  const comments = textRanges(code);
  const requireRe = /(?<![.\w$])require\(\s*(['"])([^'"\n]+)\1\s*\)/g;
  const imports = [];
  const specs = new Map();
  let out = code.replace(requireRe, (m, _q, spec, offset) => {
    if (inRanges(comments, offset)) return m;
    if (!specs.has(spec)) {
      const name = `__vinext_req_${specs.size}`;
      specs.set(spec, name);
      imports.push(`import * as ${name} from ${JSON.stringify(spec)};`);
    }
    return `${INTEROP}(${specs.get(spec)})`;
  });

  const exportsRe = /(?<![.\w$])(module\.exports|exports\.[A-Za-z_$][\w$]*)\s*=/g;
  let usesExports = false;
  for (const m of code.matchAll(exportsRe)) {
    if (!inRanges(comments, m.index)) usesExports = true;
  }
  const esExportRe = /(^|[\n;])\s*export\s+(default|const|let|var|function|class|async|\{|\*)/;
  const wrap = usesExports && !esExportRe.test(code);

  if (!imports.length && !wrap) return null;
  let head = imports.join("\n");
  if (imports.length) head += `\nimport { ${INTEROP} } from ${JSON.stringify(CJS_HELPER_ID)};`;
  if (wrap) head += "\nvar module = { exports: {} }; var exports = module.exports;";
  // Directives ("use client") must stay the first statement.
  const prologue = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*(['"])use [a-z ]+\1;?/.exec(out);
  const at = prologue ? prologue[0].length : 0;
  out = `${out.slice(0, at)}${at ? "\n" : ""}${head.replace(/^\n/, "")}\n${out.slice(at).replace(/^\n/, "")}`;
  if (wrap) out += "\nexport default module.exports;\nexport const __vinext_cjs = true;\n";
  return out;
}
