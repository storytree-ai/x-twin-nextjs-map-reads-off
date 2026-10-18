// "use cache": a function whose body starts with the directive (or every
// exported async function of a file that starts with it) runs through
// next/cache's __vinext_useCache, keyed by where it is, its arguments and
// the values it reads from enclosing functions (as Next.js binds them,
// resolved by block scope).
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

/** Every function node in the tree, with the functions that enclose it (outermost first), its parent and the switch its case is in. */
function* functions(node, outer = [], parent = null, grandparent = null) {
  if (!node || typeof node.type !== "string") return;
  const isFn = FUNCTION_TYPES.has(node.type);
  if (isFn) yield { fn: node, outer, parent, outerSwitch: grandparent && grandparent.type === "SwitchStatement" ? grandparent : null };
  const next = isFn ? [...outer, node] : outer;
  for (const c of children(node)) yield* functions(c, next, node, parent);
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

const isReference = (parent, key) =>
  !(
    (parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
    ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") &&
      key === "key" &&
      !parent.computed) ||
    ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") &&
      key === "label") ||
    parent.type === "MetaProperty"
  );

/** The let, const, class and function names statements declare in the block they are in. */
function lexicalNames(statements, out = new Set()) {
  for (const s of statements) {
    if (s.type === "VariableDeclaration" && s.kind !== "var") for (const d of s.declarations) for (const n of boundNames(d.id)) out.add(n);
    else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.add(s.id.name);
  }
  return out;
}

/** The var names node declares (hoisted to its function; not those of functions nested in it). */
function varNames(node, out) {
  if (node.type === "VariableDeclaration" && node.kind === "var") for (const d of node.declarations) for (const n of boundNames(d.id)) out.add(n);
  if (FUNCTION_TYPES.has(node.type) || node.type === "StaticBlock") return out; // their own var scopes
  for (const c of children(node)) varNames(c, out);
  return out;
}

/** The names a scope-making node binds, or null when it makes no scope. */
function scopeNames(node, parent) {
  if (FUNCTION_TYPES.has(node.type)) {
    const out = new Set(node.type === "ArrowFunctionExpression" ? [] : ["arguments"]);
    if (node.id && node.type === "FunctionExpression") out.add(node.id.name);
    for (const p of node.params) for (const n of boundNames(p)) out.add(n);
    if (node.body.type === "BlockStatement") lexicalNames(node.body.body, varNames(node.body, out));
    return out;
  }
  if (node.type === "StaticBlock") return lexicalNames(node.body, node.body.reduce((out, c) => varNames(c, out), new Set()));
  if (node.type === "BlockStatement") {
    return parent && FUNCTION_TYPES.has(parent.type) ? null : lexicalNames(node.body); // a function body is the function's scope
  }
  if (node.type === "SwitchStatement") return lexicalNames(node.cases.flatMap((c) => c.consequent));
  if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
    const head = node.type === "ForStatement" ? node.init : node.left;
    return head && head.type === "VariableDeclaration" && head.kind !== "var" ? lexicalNames([head]) : null;
  }
  if (node.type === "CatchClause") return new Set(node.param ? boundNames(node.param) : []);
  if (node.type === "ClassExpression" && node.id) return new Set([node.id.name]);
  return null;
}

/** The names fn reads that functions enclosing it declare (in the scopes fn is in), in order. */
function closedOver(fn, outer) {
  if (!outer.length) return [];
  const out = new Set();
  // scopes: the names each binds, and whether it is fn's own or one inside fn.
  const visit = (node, parent, key, scopes, inside) => {
    if (node === fn) inside = true;
    if (node.type === "Identifier") {
      if (!inside || !isReference(parent, key)) return;
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (!scopes[i].names.has(node.name)) continue;
        if (!scopes[i].inside) out.add(node.name);
        return;
      }
      return; // a module or global name
    }
    const names = scopeNames(node, parent);
    if (names) scopes = [...scopes, { names, inside }];
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") visit(c, node, k, scopes, inside);
      } else if (v && typeof v === "object" && typeof v.type === "string") visit(v, node, k, scopes, inside);
    }
  };
  visit(outer[0], null, null, [], false);
  if (fn.type === "FunctionDeclaration" && fn.id) out.delete(fn.id.name); // itself
  return [...out];
}

/** The name an anonymous function expression takes from the binding or (non-computed) key it is put in. */
function inferredName(fn, parent) {
  if (fn.id) return null;
  if (parent.type === "VariableDeclarator" && parent.init === fn && parent.id.type === "Identifier") return parent.id.name;
  if (parent.type === "AssignmentExpression" && parent.right === fn && parent.left.type === "Identifier") return parent.left.name;
  if (parent.type === "AssignmentPattern" && parent.right === fn && parent.left.type === "Identifier") return parent.left.name;
  if ((parent.type === "Property" || parent.type === "PropertyDefinition") && parent.value === fn && !parent.computed) {
    const { key } = parent;
    if (key.type === "Identifier") return key.name;
    if (key.type === "PrivateIdentifier") return `#${key.name}`;
    return typeof key.value === "string" || typeof key.value === "number" ? String(key.value) : null;
  }
  return null;
}

const isMethod = (parent) =>
  !!parent && (parent.type === "MethodDefinition" || (parent.type === "Property" && (parent.method || parent.kind !== "init")));

/**
 * The edits that send fn's body through the cache wrapper, with the values
 * it reads from enclosing functions. An inline fn is also marked as cached
 * (with those values), so another cached function may close over it.
 */
function wrapEdits(fn, outer, parent, outerSwitch, id, directive) {
  // Arrow functions have no `arguments`: their parameters' names key the entry.
  const args =
    fn.type === "ArrowFunctionExpression" ? `[${fn.params.flatMap((p) => boundNames(p)).join(", ")}]` : "Array.from(arguments)";
  const closure = closedOver(fn, outer);
  const bound = closure.length ? `{ ${closure.join(", ")} }` : "";
  const tail = bound ? `, ${bound}` : "";
  const edits = [];
  if (outer.length && !isMethod(parent)) {
    const mark = `${JSON.stringify(id)}, `;
    const getter = bound ? `, () => (${bound})` : "";
    if (fn.type === "FunctionDeclaration") {
      // Hoisted, so marked where its block starts (after any directives),
      // ahead of code that may read it; the getter reads its values later.
      // In a switch it belongs to the whole switch: marked at each case.
      const text = `__vinext_cacheRef(${mark}${fn.id.name}${getter});`;
      if (parent.type === "BlockStatement") {
        const directives = parent.body.filter((s) => typeof s.directive === "string");
        const at = directives.length ? directives[directives.length - 1].end : parent.start + 1;
        edits.push({ at, end: at, text: ` ${text}`, statement: true });
      } else if (parent.type === "StaticBlock") {
        edits.push({ at: parent.body[0].start, end: parent.body[0].start, text: `${text} `, statement: true });
      } else if (parent.type === "SwitchCase" && outerSwitch) {
        for (const c of outerSwitch.cases) {
          if (c.consequent.length) edits.push({ at: c.consequent[0].start, end: c.consequent[0].start, text: `${text} `, statement: true });
        }
      } else {
        edits.push({ at: fn.end, end: fn.end, text: ` ${text}` });
      }
    } else {
      // Ahead of the body's closing edits, which may share fn.end. The
      // wrapping hides the name fn would take from where it is put.
      const name = inferredName(fn, parent);
      const rest = name ? `${getter || ", null"}, ${JSON.stringify(name)}` : getter;
      edits.push({ at: fn.end, end: fn.end, text: `${rest})` }, { at: fn.start, end: fn.start, text: `__vinext_cacheRef(${mark}` });
    }
  }
  const open = `__vinext_useCache(${JSON.stringify(id)}, ${args}, async () => `;
  if (fn.body.type !== "BlockStatement") {
    edits.push(
      { at: fn.body.start, end: fn.body.start, text: `${open}(` },
      { at: fn.body.end, end: fn.body.end, text: `)${tail})` },
    );
    return edits;
  }
  const start = directive ? directive.start : fn.body.start + 1;
  const end = directive ? directive.end : fn.body.start + 1;
  edits.push(
    { at: start, end, text: `return ${open}{` },
    { at: fn.body.end - 1, end: fn.body.end - 1, text: `}${tail}); ` },
  );
  return edits;
}

/** code with its "use cache" functions wrapped, or null when it has none. */
export function transformUseCache(code, ast, file) {
  const edits = [];
  const fileLevel = isUseCache(ast.body[0]);
  const seen = new Set();
  const add = (fn, outer, parent, outerSwitch, directive) => {
    if (seen.has(fn)) return;
    seen.add(fn);
    edits.push(...wrapEdits(fn, outer, parent, outerSwitch, `${file}:${fn.start}`, directive));
  };
  for (const { fn, outer, parent, outerSwitch } of functions(ast)) {
    const first = fn.body && fn.body.type === "BlockStatement" ? fn.body.body[0] : null;
    if (isUseCache(first)) add(fn, outer, parent, outerSwitch, first);
  }
  if (fileLevel) for (const fn of exportedFunctions(ast)) add(fn, [], null, null, null);
  if (!edits.length) return null;
  const marks = edits.some((e) => e.text.includes("__vinext_cacheRef("));
  // From the end back; at one offset the edit applied last comes first, so
  // a mark put ahead of a statement is applied after the statement's own.
  edits.sort((a, b) => b.at - a.at || !!a.statement - !!b.statement);
  let out = code;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return `import { __vinext_useCache${marks ? ", __vinext_cacheRef" : ""} } from "next/cache";${out}`;
}
