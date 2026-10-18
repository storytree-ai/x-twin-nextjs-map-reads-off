// "use cache": a function whose body starts with the directive (or every
// exported async function of a file that starts with it) runs through
// next/cache's __vinext_useCache, keyed by where it is and its arguments.
// Works on the ESTree of plain JS (TypeScript and JSX already stripped).

const isUseCache = (stmt) =>
  !!stmt && stmt.type === "ExpressionStatement" && typeof stmt.directive === "string" && /^use cache(:|$)/.test(stmt.directive);

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Every function node in the tree. */
function* functions(node) {
  if (!node || typeof node.type !== "string") return;
  if (FUNCTION_TYPES.has(node.type)) yield node;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) yield* functions(c);
    else if (v && typeof v === "object" && typeof v.type === "string") yield* functions(v);
  }
}

/** The exported (async) functions of a module. */
function exportedFunctions(program) {
  const out = [];
  for (const stmt of program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : null;
    if (decl && FUNCTION_TYPES.has(decl.type) && decl.async) out.push(decl);
  }
  return out;
}

/** The names a parameter pattern binds. */
function boundNames(pattern, out = []) {
  if (!pattern) return out;
  if (pattern.type === "Identifier") out.push(pattern.name);
  else if (pattern.type === "AssignmentPattern") boundNames(pattern.left, out);
  else if (pattern.type === "RestElement") boundNames(pattern.argument, out);
  else if (pattern.type === "ArrayPattern") for (const el of pattern.elements) boundNames(el, out);
  else if (pattern.type === "ObjectPattern") {
    for (const p of pattern.properties) boundNames(p.type === "RestElement" ? p.argument : p.value, out);
  }
  return out;
}

/** The edits that send fn's body through the cache wrapper. */
function wrapEdits(fn, id, directive) {
  // Arrow functions have no `arguments`: their parameters' names key the entry.
  const args =
    fn.type === "ArrowFunctionExpression" ? `[${fn.params.flatMap((p) => boundNames(p)).join(", ")}]` : "Array.from(arguments)";
  const open = `__vinext_useCache(${JSON.stringify(id)}, ${args}, async () => `;
  if (fn.body.type !== "BlockStatement") {
    return [
      { at: fn.body.start, end: fn.body.start, text: `${open}(` },
      { at: fn.body.end, end: fn.body.end, text: "))" },
    ];
  }
  const start = directive ? directive.start : fn.body.start + 1;
  const end = directive ? directive.end : fn.body.start + 1;
  return [
    { at: start, end, text: `return ${open}{` },
    { at: fn.body.end - 1, end: fn.body.end - 1, text: "}); " },
  ];
}

/** code with its "use cache" functions wrapped, or null when it has none. */
export function transformUseCache(code, ast, file) {
  const edits = [];
  const fileLevel = isUseCache(ast.body[0]);
  const seen = new Set();
  const add = (fn, directive) => {
    if (seen.has(fn)) return;
    seen.add(fn);
    edits.push(...wrapEdits(fn, `${file}:${fn.start}`, directive));
  };
  for (const fn of functions(ast)) {
    const first = fn.body && fn.body.type === "BlockStatement" ? fn.body.body[0] : null;
    if (isUseCache(first)) add(fn, first);
  }
  if (fileLevel) for (const fn of exportedFunctions(ast)) add(fn, null);
  if (!edits.length) return null;
  edits.sort((a, b) => b.at - a.at);
  let out = code;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return `import { __vinext_useCache } from "next/cache";${out}`;
}
