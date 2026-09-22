// Every name a source file USES is a name something declares.
//
// This suite exists because of a bug that reached a user. Extracting the
// schedule review table into its own component moved `trackRows` and
// `creatingTracks` out of SrhSeasonImportModal, but left two references to them
// behind in the summary line above it. Nothing caught it: `next build` compiles
// a ReferenceError happily, the render tests only mount components in their
// initial state, and the source-text suites read for patterns rather than for
// meaning. So the importer compiled, shipped, and threw
// "trackRows is not defined" into Next's error boundary the moment a schedule
// was read — the whole Schedule page replaced by "Something went wrong", on the
// one press the feature exists for.
//
// A ReferenceError in a React component is not a small bug. It is never a bad
// value in one cell: the render throws, the boundary swallows the entire page,
// and the message a user gets names a variable rather than anything they did.
// It is also exactly the kind of mistake that extracting a component invites,
// which this codebase does often and deliberately.
//
// So the rule is checked mechanically, across every file the app ships. Each
// file is parsed with the same SWC that `next build` uses, every binding it
// introduces is collected, and every identifier it reads is looked up. A name
// that is read but bound nowhere in the file, and is not a platform global, is
// a ReferenceError waiting for the branch that renders it.
//
// The check is deliberately one-sided. Bindings are collected from the whole
// file rather than per scope, so a name declared in some other function still
// counts as declared — this suite is not a scope analyser and will never fail a
// file for a shadowing subtlety. What it catches is the only case that matters
// here: a name that nothing in the file declares at all.
import assert from "node:assert";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { parse } = require("next/dist/build/swc");

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// Names the platform supplies. A file may read any of these without declaring
// them; anything else it reads, it has to bind.
const GLOBALS = new Set([
  // Language built-ins
  "undefined", "NaN", "Infinity", "globalThis", "Object", "Array", "String", "Number", "Boolean",
  "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp", "Function", "Proxy", "Reflect", "Intl",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Promise", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite", "escape", "unescape",
  "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent", "structuredClone",
  // Browser
  "window", "document", "navigator", "location", "history", "screen", "self", "top", "parent",
  "frames", "localStorage", "sessionStorage", "console", "alert", "confirm", "prompt",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
  "fetch", "Request", "Response", "Headers", "FormData", "Blob", "File", "FileReader", "FileList",
  "URL", "URLSearchParams", "AbortController", "AbortSignal", "Image", "Audio", "OffscreenCanvas",
  "createImageBitmap", "ImageBitmap", "ImageData", "Event", "CustomEvent", "EventTarget",
  "MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver",
  "getComputedStyle", "matchMedia", "atob", "btoa", "crypto", "performance", "CSS",
  "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLCanvasElement", "DOMParser",
  "XMLHttpRequest", "WebSocket", "Notification", "MessageChannel", "BroadcastChannel",
  "ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder",
  "CompressionStream", "DecompressionStream", "caches", "indexedDB", "scrollTo", "scrollBy",
  // Node / bundler
  "process", "Buffer", "global", "module", "exports", "require", "__dirname", "__filename",
]);

// Node types that introduce their own parameter bindings.
const FUNCTION_NODES = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ClassMethod", "PrivateMethod", "MethodProperty", "GetterProperty", "SetterProperty",
  "Constructor",
]);

// Collect the names one file binds and the names it reads.
function analyse(ast) {
  const declared = new Set();
  const referenced = new Map(); // name -> byte offset of the first read

  const note = node => {
    if (node?.value && !referenced.has(node.value)) referenced.set(node.value, node.span?.start ?? 0);
  };

  // A binding position: everything here is DECLARED, and the default values
  // inside it are ordinary expressions that still have to be walked.
  function bind(node) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "Identifier":
      case "BindingIdentifier":
        declared.add(node.value);
        return;
      case "ObjectPattern":
        for (const p of node.properties || []) {
          if (p.type === "KeyValuePatternProperty") bind(p.value);
          else if (p.type === "AssignmentPatternProperty") { declared.add(p.key?.value); walk(p.value); }
          else if (p.type === "RestElement") bind(p.argument);
        }
        return;
      case "ArrayPattern":
        for (const e of node.elements || []) bind(e);
        return;
      case "AssignmentPattern": bind(node.left); walk(node.right); return;
      case "RestElement": bind(node.argument); return;
      default: walk(node);
    }
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (!node.type) { for (const k of Object.keys(node)) walk(node[k]); return; }

    switch (node.type) {
      // `import { a as b }` binds b, and nothing in it is a read.
      case "ImportDeclaration":
        for (const s of node.specifiers || []) declared.add(s.local?.value);
        return;
      // `export { a as b }` only re-exports locals, which are declared already.
      case "ExportNamedDeclaration":
        if (node.declaration) walk(node.declaration);
        return;
      case "VariableDeclarator":
        bind(node.id);
        walk(node.init);
        return;
      case "CatchClause":
        if (node.param) bind(node.param);
        walk(node.body);
        return;
      // `a.b` reads a; `a[b]` reads both. A static property name is not a read.
      case "MemberExpression":
        walk(node.object);
        if (node.computed || node.property?.type === "Computed") walk(node.property);
        return;
      // `{ key: value }` — the key is a name, not a read.
      case "KeyValueProperty":
        if (node.key?.type === "Computed") walk(node.key);
        walk(node.value);
        return;
      case "ClassProperty":
      case "PrivateProperty":
        if (node.key?.type === "Computed") walk(node.key);
        walk(node.value);
        return;
      // <div> is an intrinsic element; <Modal> is a read of a binding.
      case "JSXOpeningElement":
      case "JSXClosingElement": {
        const name = node.name;
        if (name?.type === "Identifier" && /^[A-Z]/.test(name.value)) note(name);
        if (name?.type === "JSXMemberExpression") {
          let obj = name.object;
          while (obj?.type === "JSXMemberExpression") obj = obj.object;
          if (obj?.type === "Identifier") note(obj);
        }
        // An attribute's NAME is not a read; its value is.
        for (const attr of node.attributes || []) {
          if (attr.type === "JSXAttribute") walk(attr.value);
          else walk(attr); // JSXSpreadAttribute
        }
        return;
      }
      case "Identifier":
        note(node);
        return;
      // Labels are not bindings and `break outer` is not a read.
      case "LabeledStatement": walk(node.body); return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (node.identifier) declared.add(node.identifier.value);
        break;
    }

    if (FUNCTION_NODES.has(node.type)) {
      if (node.identifier) declared.add(node.identifier.value);
      if (node.key?.type === "Computed") walk(node.key);
      for (const p of node.params || []) bind(p.type === "Parameter" ? p.pat : p);
      walk(node.body);
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === "type" || k === "span" || k === "ctxt") continue;
      walk(node[k]);
    }
  }

  walk(ast.body);
  return { declared, referenced };
}

// Every file the app actually ships. Tests are excluded: they are run, so a
// name missing from one fails loudly on its own.
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = ["app", "components", "lib"]
  .map(d => path.join(appRoot, d))
  .flatMap(d => sourceFiles(d));

ok("there are app sources to check", files.length > 200);

const offences = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  let ast;
  try {
    ast = await parse(source, {
      filename: file,
      jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022" },
    });
  } catch (err) {
    // A file the compiler can't read is a failure in its own right — `next
    // build` would not get past it either.
    offences.push(`${path.relative(appRoot, file)}: could not be parsed — ${err.message}`);
    continue;
  }
  const module = typeof ast === "string" ? JSON.parse(ast) : ast;
  const base = module.span?.start ?? 0;
  const { declared, referenced } = analyse(module);
  for (const [name, at] of referenced) {
    if (declared.has(name) || GLOBALS.has(name)) continue;
    const line = source.slice(0, Math.max(0, at - base)).split("\n").length;
    offences.push(`${path.relative(appRoot, file)}:${line} — "${name}" is used but never declared`);
  }
}

n++;
assert.deepStrictEqual(offences, [],
  `every name a file uses must be declared somewhere in it, or be a platform global.\n\n${offences.join("\n")}\n`);

// The walker has to be right about what IS and is NOT a read, or the check
// above passes by being blind. These are the shapes that would make it so —
// each one written the way it appears in this codebase.
{
  const analyseSource = async src => {
    const ast = await parse(src, { filename: "t.jsx", jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022" } });
    const mod = typeof ast === "string" ? JSON.parse(ast) : ast;
    const { declared, referenced } = analyse(mod);
    return [...referenced.keys()].filter(name => !declared.has(name) && !GLOBALS.has(name));
  };

  // The bug this suite was written for, in miniature.
  assert.deepStrictEqual(await analyseSource(
    "export function C({ preview }) { const rows = preview.rows; return <p>{rows.length}{trackRows.length}</p>; }"
  ), ["trackRows"], "a name left behind by an extraction is caught");
  n++;

  // …and the same file once the binding is restored.
  assert.deepStrictEqual(await analyseSource(
    "export function C({ preview }) { const trackRows = preview.tracks || []; return <p>{trackRows.length}</p>; }"
  ), [], "…and is clean once it is declared");
  n++;

  // Things that look like reads and are not. A false positive here would make
  // the suite unusable, so each is pinned.
  for (const [label, src] of [
    ["a static property name", "const o = {}; o.trackRows;"],
    ["an object literal key", "const o = { trackRows: 1 };"],
    ["a JSX attribute name", "const e = <input trackRows='x' />;"],
    ["an intrinsic element", "const e = <div><span /></div>;"],
    ["a destructured parameter", "const f = ({ trackRows }) => trackRows;"],
    ["a renamed import", "import { a as trackRows } from 'x'; trackRows;"],
    ["a namespace import", "import * as ns from 'x'; ns.trackRows;"],
    ["a catch binding", "try { null; } catch (trackRows) { trackRows; }"],
    ["a default in a pattern", "const f = ({ a = 1, b: { c } = {} }) => a + c;"],
    ["a rest element", "const f = ({ a, ...rest }) => rest;"],
    ["an array pattern", "const [a, [b], ...c] = [];  a; b; c;"],
    ["a for-of binding", "for (const row of []) { row; }"],
    ["a class method name", "class K { trackRows() { return 1; } }"],
    ["a getter name", "const o = { get trackRows() { return 1; } };"],
    ["a labelled break", "outer: for (;;) { break outer; }"],
    ["a function expression's own name", "const f = function go(n) { return n ? go(n - 1) : 0; };"],
    ["a hoisted function used above it", "run(); function run() { return 1; }"],
  ]) {
    assert.deepStrictEqual(await analyseSource(src), [], `${label} is not a read`);
    n++;
  }

  // Things that ARE reads, so the check cannot be passed by walking too little.
  for (const [label, src, want] of [
    ["a computed property", "const o = {}; o[trackRows];", ["trackRows"]],
    ["a JSX attribute value", "const e = <input value={trackRows} />;", ["trackRows"]],
    ["a JSX spread", "const e = <input {...trackRows} />;", ["trackRows"]],
    ["a capitalised element", "const e = <TrackRows />;", ["TrackRows"]],
    ["a namespaced element", "const e = <Track.Rows />;", ["Track"]],
    ["an object literal value", "const o = { rows: trackRows };", ["trackRows"]],
    ["a computed key", "const o = { [trackRows]: 1 };", ["trackRows"]],
    ["a template literal", "const s = `${trackRows}`;", ["trackRows"]],
    ["a default value expression", "const f = ({ a = trackRows }) => a;", ["trackRows"]],
    ["a JSX child", "const e = <p>{trackRows.length}</p>;", ["trackRows"]],
  ]) {
    assert.deepStrictEqual(await analyseSource(src), want, `${label} is a read`);
    n++;
  }
}

console.log(`undefinedNames: ${n} checks passed across ${files.length} app source files`);
