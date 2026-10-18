// "use cache": a function whose body starts with the directive (or every
// exported async function of a file that starts with it) runs through
// next/cache's __vinext_useCache, keyed by where it is, its arguments and
// the values it reads from enclosing functions (as Next.js binds them).
// Works on the ESTree of plain JS (TypeScript and JSX already stripped).

const isUseCache = (stmt) =>
  !!stmt && stmt.type === "ExpressionStatement" && typeof stmt.directive === "string" && /^use cache(:|$)/.test(stmt.directive);

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** The child nodes of node. */
function* children(node) {
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") yield c;
    } else if (v && typeof v === "object" && typeof v.type === "string") yield v;
  }
}

/** Every function node in the tree, with the functions that enclose it (outermost first). */
function* functions(node, outer = []) {
  if (!node || typeof node.type !== "string") return;
  const isFn = FUNCTION_TYPES.has(node.type);
  if (isFn) yield { fn: node, outer };
  const next = isFn ? [...outer, node] : outer;
  for (const c of children(node)) yield* functions(c, next);
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

/** The names a function's parameters and body declare (not those of functions nested in it). */
function declaredNames(fn) {
  const out = new Set();
  if (fn.id && fn.type === "FunctionExpression") out.add(fn.id.name);
  for (const p of fn.params) for (const n of boundNames(p)) out.add(n);
  const visit = (node) => {
    if (node.type === "VariableDeclaration") for (const d of node.declarations) for (const n of boundNames(d.id)) out.add(n);
    else if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) out.add(node.id.name);
    else if (node.type === "CatchClause" && node.param) for (const n of boundNames(node.param)) out.add(n);
    if (FUNCTION_TYPES.has(node.type)) return;
    for (const c of children(node)) visit(c);
  };
  visit(fn.body);
  return out;
}

const isReference = (parent, key) =>
  !(
    (parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
    ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") &&
      key === "key" &&
      !parent.computed) ||
    ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") &&
      key === "label")
  );

/** The names fn reads without declaring them itself (nor in a function nested in it that reads them). */
function freeNames(fn) {
  const out = new Set();
  const visit = (node, parent, key) => {
    if (node.type === "Identifier") {
      if (isReference(parent, key)) out.add(node.name);
      return;
    }
    if (FUNCTION_TYPES.has(node.type)) {
      // A nested function's own reads, less what it declares; its name belongs to fn.
      for (const n of freeNames(node)) out.add(n);
      if (node.type === "FunctionDeclaration" && node.id) out.add(node.id.name);
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") visit(c, node, k);
      } else if (v && typeof v === "object" && typeof v.type === "string") visit(v, node, k);
    }
  };
  for (const p of fn.params) visit(p, fn, "params"); // default values
  visit(fn.body, fn, "body");
  const own = declaredNames(fn);
  return new Set([...out].filter((n) => !own.has(n)));
}

/** The names fn reads that functions enclosing it declare, in order. */
function closedOver(fn, outer) {
  if (!outer.length) return [];
  const outerNames = new Set();
  for (const o of outer) for (const n of declaredNames(o)) outerNames.add(n);
  return [...freeNames(fn)].filter((n) => outerNames.has(n));
}

/** The edits that send fn's body through the cache wrapper. */
function wrapEdits(fn, outer, id, directive) {
  // Arrow functions have no `arguments`: their parameters' names key the entry.
  let args =
    fn.type === "ArrowFunctionExpression" ? `[${fn.params.flatMap((p) => boundNames(p)).join(", ")}]` : "Array.from(arguments)";
  const closure = closedOver(fn, outer);
  if (closure.length) args = `[${args}, [${closure.join(", ")}]]`;
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
  const add = (fn, outer, directive) => {
    if (seen.has(fn)) return;
    seen.add(fn);
    edits.push(...wrapEdits(fn, outer, `${file}:${fn.start}`, directive));
  };
  for (const { fn, outer } of functions(ast)) {
    const first = fn.body && fn.body.type === "BlockStatement" ? fn.body.body[0] : null;
    if (isUseCache(first)) add(fn, outer, first);
  }
  if (fileLevel) for (const fn of exportedFunctions(ast)) add(fn, [], null);
  if (!edits.length) return null;
  edits.sort((a, b) => b.at - a.at);
  let out = code;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return `import { __vinext_useCache } from "next/cache";${out}`;
}
