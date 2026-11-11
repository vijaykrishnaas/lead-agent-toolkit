const { maskStringLiterals, maskComments } = require('../utils/maskStringLiterals');
const { HTTP_METHODS } = require('./httpMethods');
const VERB_ALTERNATION = HTTP_METHODS.join('|');
// A verb call's path argument: one whole quoted string literal (escapes kept
// as written). `'/a' + suffix` is not one -- there is more after the closing
// quote -- so it is never read as a route at `/a` (see classifyVerbCalls).
const PATH_LITERAL_ARG_PATTERN = /^(['"])((?:\\.|(?!\1)[^\\\n])*)\1$/;
// A route path must start with "/" or "*": app.get('env') /
// req.app.get('title') is Express's settings getter (same receiver, same verb
// name), not a route.
const ROUTE_PATH_START_PATTERN = /^[/*]/;
// Mounts -- app.use(prefix, router) in the app entry file, and the same
// syntax on a router receiver for a nested sub-router -- are not matched by
// one whole-call regex: analyzeUseCalls splits each use(...) call's argument
// list by depth and reads only the first argument (prefix) and the last
// (router), so the shape of any middleware in between cannot drop the mount.
// A whole quoted string literal with no escapes: the prefix exactly as
// Express sees it. `'/api' + '/v1'` is not one (it has a top-level operator).
const STRING_LITERAL_ARG_PATTERN = /^(['"])((?:(?!\1)[^\\\n])*)\1$/;
const IDENTIFIER_ARG_PATTERN = /^[A-Za-z_$][\w$]*$/;
// An inline require('./x') (optionally one member deep) as the router.
const INLINE_REQUIRE_ARG_PATTERN = /^require\(\s*(['"])(.*?)\1\s*\)(?:\.([A-Za-z_$][\w$]*))?$/;
// An inline function/arrow argument: middleware, whatever its body holds.
const INLINE_FUNCTION_ARG_PATTERN = /^(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;
// `const API = '/api';` -- a prefix held in a variable. Only a `const` whose
// whole initializer is one string literal counts (not `'/a' + x`, not a
// reassignable let/var), so the resolved prefix is exactly what Express sees.
// A literal ending its line without a `;` only counts when the next line does
// not continue the expression (`const API = '/a'` / `  + version`), which
// would otherwise resolve to just the first operand.
const CONST_STRING_PATTERN = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\\\n]*)\2[ \t]*(?:;|$(?!\s*[-+*/%.?:|&,[(<>=]))/gm;
// Any `const|let|var x = <initializer>` binding, capturing the initializer's
// first line. Used to tell a prefix variable the parser cannot resolve
// (`const API = process.env.API_PREFIX || '/api'`, a template literal, a
// reassignable `let API = '/api'`) from middleware (see
// collectUnresolvablePrefixNames).
const BINDING_PATTERN = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]*)/g;
// Initializers that make a binding middleware-shaped rather than a prefix:
// a function/arrow expression, or a call -- require('./auth'), and factory
// calls such as rateLimit({...}) / express.json() / new Limiter() (awaited
// or not), which is how most middleware is built.
const MIDDLEWARE_INITIALIZER_PATTERN = /^(?:(?:async\s+)?function\b|(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:await\s+)?(?:new\s+)?[A-Za-z_$][\w$.]*\s*\()/;
// What follows a right-hand side that ended at a line end when the next line
// continues the expression -- the operator set CONST_STRING_PATTERN refuses.
const INITIALIZER_CONTINUATION_PATTERN = /^\n\s*[-+*/%.?:|&,[(<>=]/;
const REQUIRE_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])(.*?)\2\s*\)/g;
// `const { tasks, users: usersRouter } = require('./routes');` -- names bound
// by destructuring a require. Only a flat pattern (no nested `{}`) matches.
const DESTRUCTURED_REQUIRE_PATTERN = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*require\(\s*(['"])(.*?)\2\s*\)/g;
// One member of a binding as the router: `routes.tasks` (or `routes?.tasks`).
const MEMBER_ARG_PATTERN = /^([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)$/;
// A barrel file's exports (see findExportedRequire): the opening of a
// `module.exports = {` (or `module.exports = exports = {`) object literal, one `key`, `key: value` or
// `'key': value` entry of it, and an `exports.<name> =` /
// `module.exports.<name> =` property assignment.
const MODULE_EXPORTS_OBJECT_PATTERN = /\bmodule\s*\.\s*exports\s*=\s*(?:exports\s*=\s*)?\{/g;
const EXPORT_ENTRY_PATTERN = /^(?:([A-Za-z_$][\w$]*)|(['"])([^'"\\\n]*)\2)\s*(?::\s*([\s\S]+))?$/;
const EXPORT_ASSIGNMENT_PATTERN = /(?<![\w$.])(?:module\s*\.\s*)?exports\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
// Barrels that hand on exports wholesale (see analyzeExports): a live
// `module.exports = <rhs>` statement (any right-hand side; the `{` form is
// counted too, so "the file's only export statement" can be checked), and an
// `Object.assign(module.exports, ...)` / `Object.assign(exports, ...)` call.
const WHOLE_MODULE_EXPORT_PATTERN = /(?<![\w$.])module\s*\.\s*exports\s*=(?![=>])/g;
const OBJECT_ASSIGN_EXPORTS_PATTERN = /\bObject\s*\.\s*assign\(\s*(?:module\s*\.\s*)?exports\s*,/g;
// Matches router.route('/path') / app.route('/path') so its chained
// .<verb>(...) calls (e.g. .get(fn).post(fn)) can be found separately —
// the head-call walk (CHAIN_HEAD_PATTERN) can't see them because the verb
// call isn't preceded by "router."/"app." directly, only by the
// ").route(...)" chain.
const ROUTE_CALL_PATTERN = /\.route\(\s*(['"])(.*?)\1\s*\)/g;
// `all` is matched too: `.all(mw)` is the per-path middleware hook in a route
// chain, not an HTTP verb, so it adds no route — but the chain continues past
// it, and stopping there dropped every real verb chained after it.
const CHAINED_VERB_START_PATTERN = new RegExp(`^\\.(${VERB_ALTERNATION}|all)\\(`);

// Mirror of ROUTE_CALL_PATTERN and the mount prefix, but
// matching a template-literal-delimited (backtick) path/prefix argument
// instead of a quoted one. A template literal can embed an interpolated
// expression (e.g. `` `/api/${version}/things` ``) whose actual runtime
// value can't be determined by static text scanning, so none of the
// quote-only patterns above ever match it -- the route/mount silently never
// appeared on the code side of the comparison at all (AUDIT.md F8). These
// patterns only need to detect *that* such a call exists and where, not
// resolve its path, so they stop right after the opening backtick. An array
// path (`['/a', '/b']`) is the same silent drop, so `[` is matched too.
// (A verb call's own path is classified by classifyVerbCalls instead.)
const UNPARSED_ROUTE_CALL_PATTERN = /\.route\(\s*[`[]/g;
const UNPARSED_MOUNT_PATTERN = /\b(?:router|app)\s*\.use\(\s*[`[]/g;

// The head of a call chain: any live app|router.<verb>( / .use( / .all( call,
// matched against the fully masked source so its arguments can be split by
// depth (see splitTopLevelArgs). Each of these returns the app/router itself,
// so a .<verb>( / .use( / .all( written directly onto its closing paren
// (CHAIN_LINK_PATTERN) runs against the same receiver. `\s*` before the dot:
// a receiver on its own line (`app` / `  .use(...)`) is the same call.
const CHAIN_HEAD_PATTERN = new RegExp(`\\b(?:router|app)\\s*\\.(${VERB_ALTERNATION}|all|use)\\(`, 'g');
const CHAIN_LINK_PATTERN = new RegExp(`^\\s*\\.(${VERB_ALTERNATION}|all|use)\\(`);

// A match whose first character was blanked by the full string-and-comment
// mask starts inside a string/template literal (e.g. a log message quoting
// "router.get('/x', h)"), so it's text, not a live call. `commentMasked`
// keeps string content intact for the capture groups, so liveness is checked
// against the fully masked copy at the match's start.
function matchIsLive(match, masked) {
  return masked[match.index] === match[0][0];
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Walks forward from `chainStart` (right after a .route(path) call)
// collecting only .<verb>(...) calls that are *directly* chained — i.e.
// nothing but whitespace (or a masked-out comment, which reads as
// whitespace to \s*) between one call's closing ")" and the next ".".
// Each call's own argument list is skipped by paren-depth (using `masked`,
// a string-and-comment-safe version of `source` from maskStringLiterals, so
// a stray "(" or ")" inside a string/template literal or a comment in a
// handler body can't desync the depth count), not by jumping to the *next*
// .route() call's index — that boundary is unsafe whenever unrelated code
// (e.g. a separate router.<verb>(...) statement) sits between two .route()
// chains, since it would sweep that unrelated statement's own verb call
// into this chain. See CLAUDE.md's per-occurrence-scoping guideline, which
// names this exact "next occurrence's start" shape as unsafe for the same
// reason. `commentMasked` (comments blanked, string content left intact —
// unlike `masked`, which blanks both) is used for the verb-name match
// itself, so a commented-out `.post(createA)` between two real chained
// calls isn't picked up as if it were live code.
function collectChainedVerbs(commentMasked, masked, chainStart) {
  const verbs = [];
  let pos = chainStart;
  while (pos < commentMasked.length) {
    const wsLen = /^\s*/.exec(commentMasked.slice(pos))[0].length;
    const afterWs = pos + wsLen;
    const verbMatch = CHAINED_VERB_START_PATTERN.exec(commentMasked.slice(afterWs));
    if (!verbMatch) break;
    if (verbMatch[1] !== 'all') verbs.push(verbMatch[1].toUpperCase());
    let depth = 1;
    let i = afterWs + verbMatch[0].length;
    while (i < masked.length && depth > 0) {
      if (masked[i] === '(') depth += 1;
      else if (masked[i] === ')') depth -= 1;
      i += 1;
    }
    pos = i;
  }
  return verbs;
}

// Every call in every app|router call chain, in source order: the head
// (`router.get(...)`, `app.use(...)`) and each .<verb>( / .use( / .all( call
// directly chained onto the previous call's closing paren -- nothing but
// whitespace between them on `masked`, where a commented-out link reads as
// whitespace and so is skipped without ending the chain. Each call's own
// argument list is skipped by depth (splitTopLevelArgs), never by jumping to
// the next occurrence. Each entry is { name, index, argsStart, args,
// closeIndex, isChained }; `index` is the receiver's start for a head and the
// "." for a chained link. Any other link (.listen(, .route() ends the walk.
function collectCallChains(masked) {
  const calls = [];
  for (const head of masked.matchAll(CHAIN_HEAD_PATTERN)) {
    let call = { name: head[1], index: head.index, argsStart: head.index + head[0].length, isChained: false };
    while (call) {
      const args = splitTopLevelArgs(masked, call.argsStart);
      if (!args) break;
      const closeIndex = args[args.length - 1][1];
      calls.push({ ...call, args, closeIndex });
      const link = CHAIN_LINK_PATTERN.exec(masked.slice(closeIndex + 1));
      call = link && {
        name: link[1],
        index: closeIndex + 1 + link[0].indexOf('.'),
        argsStart: closeIndex + 1 + link[0].length,
        isChained: true,
      };
    }
  }
  return calls;
}

// `const NAME = '<literal>';` bindings by name (see CONST_STRING_PATTERN) --
// the one const-string lookup, shared by mount prefixes and verb paths.
// A name bound more than once in the file (a `const P` in each of two
// functions, or a `let P` elsewhere) is left out: this lookup has no scopes,
// so it cannot tell which binding a use refers to, and resolving to the last
// one listed routes at a path Express never serves. Left out, the name reads
// as unresolvable and its uses warn.
function collectConstStrings(commentMasked, masked) {
  const constStringsByVarName = new Map();
  for (const match of commentMasked.matchAll(CONST_STRING_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    constStringsByVarName.set(match[1], match[3]);
  }
  const bindingCounts = new Map();
  for (const match of commentMasked.matchAll(BINDING_PATTERN)) {
    if (matchIsLive(match, masked)) bindingCounts.set(match[2], (bindingCounts.get(match[2]) || 0) + 1);
  }
  for (const name of [...constStringsByVarName.keys()]) {
    if (bindingCounts.get(name) > 1) constStringsByVarName.delete(name);
  }
  return constStringsByVarName;
}

// Classifies every live app|router.<verb>(...) call -- a head call or a verb
// chained onto a verb/use call -- by its first top-level argument, split by
// depth on the masked source the way analyzeUseCalls reads a mount prefix.
// Heads come first, then chained links, each in source order. Each entry is
// { method, index, isChained, path, warn }:
//   - one whole quoted string literal, or a `const` bound to a single string
//     literal, starting with "/" or "*" -> `path` is that value;
//   - a quoted literal (or such a const) starting with anything else, or any
//     other call with fewer than two arguments -> neither: app.get('env') is
//     the settings getter, not a route;
//   - any other first argument of a call with two or more arguments -- a
//     concatenation (`'/a' + suffix`), another identifier or member, a
//     ternary, a template literal, an array, a regex literal -> `warn`: the
//     route exists but its path cannot be read statically. Nothing is
//     evaluated.
// Limit: a regex-literal path holding a quote, an unbalanced bracket or a
// `//` defeats the string/comment mask (which knows no regex syntax), so
// such a call may be mis-split or not seen at all.
function classifyVerbCalls(commentMasked, masked) {
  const constStringsByVarName = collectConstStrings(commentMasked, masked);
  const argText = ([start, end]) => commentMasked.slice(start, end).trim();
  const classified = [];
  for (const call of collectCallChains(masked)) {
    if (!HTTP_METHODS.includes(call.name)) continue;
    const args = call.args.slice();
    // A trailing comma -- router.get(PATH, h,) -- is not another argument.
    if (argText(args[args.length - 1]) === '') args.pop();
    const first = args.length > 0 ? argText(args[0]) : '';
    const literal = PATH_LITERAL_ARG_PATTERN.exec(first);
    const isConstString = IDENTIFIER_ARG_PATTERN.test(first) && constStringsByVarName.has(first);
    let path = null;
    let warn = false;
    if (literal || isConstString) {
      const value = literal ? literal[2] : constStringsByVarName.get(first);
      if (ROUTE_PATH_START_PATTERN.test(value)) path = value;
    } else if (args.length >= 2) {
      warn = true;
    }
    classified.push({ method: call.name.toUpperCase(), index: call.index, isChained: call.isChained, path, warn });
  }
  return [...classified.filter((call) => !call.isChained), ...classified.filter((call) => call.isChained)];
}

// Extracts { method, path } route entries from a single Express router file's
// source text (e.g. tasks.routes.js). Only router.<verb>(path, ...) calls,
// verbs chained onto one (router.get('/a', h).post('/b', h)) or onto a use(),
// and router.route(path).<verb>(...) chains count as routes — router.use
// (middleware) and similar are ignored because neither pattern matches
// anything but a recognized HTTP verb.
//
// All top-level route-detection regexes (ROUTE_CALL_PATTERN here,
// REQUIRE_PATTERN/CONST_STRING_PATTERN in analyzeUseCalls) are matched against
// `commentMasked`, not raw `source` — a commented-out call like
// `// router.delete('/:id', remove);` is not real, live code, but a raw
// regex match can't tell the difference, and would report a dead route as
// implemented (silencing a genuine doc-drift finding for a route that's
// documented in openapi.yaml but was actually removed/disabled in code).
// `commentMasked` blanks only comments, leaving string content (the quoted
// path itself) intact, unlike `maskStringLiterals`'s own `masked`, which
// would blank the path text too and break the capture groups these regexes
// rely on.
function parseRouterSource(source) {
  const { masked: commentMasked } = maskComments(source);
  const { masked } = maskStringLiterals(source);
  const routes = [];
  // Head calls, then verbs chained onto a verb/use call (each carries its
  // own path argument) -- see classifyVerbCalls.
  for (const call of classifyVerbCalls(commentMasked, masked)) {
    if (call.path !== null) routes.push({ method: call.method, path: call.path });
  }

  // For each .route(path) call, its chained verbs are only the .<verb>(...)
  // calls directly chained onto it (see collectChainedVerbs) — not "whatever
  // appears before the next .route() call," which would misattribute an
  // unrelated router.<verb>(...) statement sitting between two chains.
  for (const routeMatch of commentMasked.matchAll(ROUTE_CALL_PATTERN)) {
    if (!matchIsLive(routeMatch, masked)) continue;
    const path = routeMatch[2];
    const chainStart = routeMatch.index + routeMatch[0].length;
    for (const method of collectChainedVerbs(commentMasked, masked, chainStart)) {
      routes.push({ method, path });
    }
  }

  return routes;
}

// Names bound in this file to something that is neither middleware-shaped
// (MIDDLEWARE_INITIALIZER_PATTERN) nor a const single string literal (which
// parseAppEntrySource resolves). As the first of two or more use(...)
// arguments such a name is a prefix whose value can't be read statically:
// mounting the router at '' would report every one of its routes under the
// wrong path, so the mount is dropped and findUnparsedRoutes warns instead.
// Limits: an unbound name, a function declaration, a destructured binding
// and a dotted member (`config.apiPrefix` looks exactly like
// `auth.requireAuth`) are all still treated as middleware, i.e. prefix ''.
function collectUnresolvablePrefixNames(commentMasked, masked) {
  const constStrings = collectConstStrings(commentMasked, masked);
  const names = new Set();
  for (const match of commentMasked.matchAll(BINDING_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    const [, , name, initializer] = match;
    if (constStrings.has(name)) continue;
    if (MIDDLEWARE_INITIALIZER_PATTERN.test(initializer)) continue;
    names.add(name);
  }
  return names;
}

// Extracts the routes defined directly on the app/router object (e.g.
// app.get('/health', ...)) plus its own app.use|router.use(prefix, router)
// mounts from an Express source file's text (the app entry file, e.g.
// app.js, or a router file that itself mounts a nested sub-router),
// resolving each mount's router variable back to the file it was
// require()'d from. Any middleware args between the prefix and the router
// (app.use(prefix, authMiddleware, router), an inline function, an array)
// are ignored whatever their shape — only the last argument is treated as
// the router, and a chained .use(...) is read too (see analyzeUseCalls). The
// prefix may be omitted entirely (app.use(router)), giving prefix '', or be
// a const bound to a string literal (app.use(API, router)); a prefix
// variable bound to anything else non-middleware is not mounted at all (see
// collectUnresolvablePrefixNames). A mount
// whose variable has no matching require(...) in the same source is skipped
// (e.g. app.use(express.json()), not a route module). directRoutes reuses
// parseRouterSource so router.route(path).<verb>() chains are recognized
// here too, not just plain router.<verb>(path) calls.
function parseAppEntrySource(source) {
  const directRoutes = parseRouterSource(source);
  const { masked: commentMasked } = maskComments(source);
  const { masked } = maskStringLiterals(source);
  const mounts = [];
  for (const call of analyzeUseCalls(commentMasked, masked)) {
    if (call.mount) mounts.push(call.mount);
  }
  return { directRoutes, mounts };
}

// Splits a call's argument list at its top-level commas. `argsStart` is the
// index right after the call's opening "(". Depth is counted over (), [] and
// {} on `masked` (strings and comments blanked), so a comma, bracket or
// operator inside a string, a comment or a nested call never splits or ends
// the list. Returns [start, end) index pairs, or null when the call never
// closes.
function splitTopLevelArgs(masked, argsStart) {
  const args = [];
  let depth = 0;
  let start = argsStart;
  for (let i = argsStart; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ')') {
      if (depth === 0) {
        args.push([start, i]);
        return args;
      }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

// True when masked argument text has a binary/conditional operator (`+`,
// `||`, `??`, `? :`) outside any nested (), [] or {} -- i.e. the argument is
// itself an expression to evaluate, not a name, member, call or literal.
// Optional chaining (`a?.b`) is not an operator here.
function hasTopLevelOperator(maskedArg) {
  let depth = 0;
  for (let i = 0; i < maskedArg.length; i += 1) {
    const ch = maskedArg[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth !== 0) continue;
    else if (ch === '+') return true;
    else if (ch === '|' && maskedArg[i + 1] === '|') return true;
    else if (ch === '?') {
      const next = maskedArg[i + 1];
      const optionalChain = next === '.' && !/\d/.test(maskedArg[i + 2] || '');
      if (!optionalChain) return true;
    }
  }
  return false;
}

// The local names a flat destructuring pattern's body binds, each with the
// export it reads: `a` ({ local: 'a', key: 'a' }), the alias in `a: b`
// ({ local: 'b', key: 'a' }), either with a default (`a = x`), and a rest
// element (`...rest`, key null -- it is not one named export).
function destructuredNames(patternBody) {
  const names = [];
  for (const part of patternBody.split(',')) {
    const binding = part.split('=')[0];
    const isRest = binding.includes('...');
    const colon = binding.indexOf(':');
    const local = binding.slice(colon + 1).replace('...', '').trim();
    const key = isRest ? null : (colon === -1 ? local : binding.slice(0, colon).trim());
    if (IDENTIFIER_ARG_PATTERN.test(local)) names.push({ local, key: key && IDENTIFIER_ARG_PATTERN.test(key) ? key : null });
  }
  return names;
}

// Builds the lookup from an expression's text to the file it comes from:
// returns resolve(text) -> { requirePath, exportName } or null. A router
// reached one step away from a relative require -- `routes.tasks` where
// `routes` is a require binding, or a name destructured from the require --
// resolves to the required file, exactly as the inline `require('./x').member`
// form does, and carries the member/destructured export name (the original
// key for an alias `a: b`) so the collector can follow a barrel file's named
// export (see findExportedRequire). Both are relative-only: `express.json` /
// `const { Router } = require('express')` are never router files in this
// repo. exportName is null for a whole-module binding or a rest element.
// A local whose whole initializer is one member of an inline relative require
// (`const tasks = require('./routes').tasks;`) resolves like the destructured
// form, to { requirePath, exportName: 'tasks' }.
//
// An identifier may also be bound to one call of a relative one of those
// forms -- a router factory's result held in a local before it is mounted:
// `const tasksRouter = makeTasksRouter(db)`, `= routes.tasks(db)`, a
// destructured name called, `= require('./x')(db)`, `= require('./x').tasks(db)`
// -- and resolves to the callee's file and export name. Only a
// `const|let|var name = <initializer>` whose whole initializer (to the
// statement's `;` or line end at depth 0, see rightHandSideEnd) is that one
// call counts, and only one level: a name bound to a call of another
// call-bound name, a later assignment (`let r; r = make(db);`),
// `new Make(db)`, `await make(db)`, `make(db).router`, `make(db)(x)` and a
// call on a bare package (`rateLimit({...})`, `express.Router()`) stay
// unresolved, as does an initializer the next line carries on
// (`make(db)` / `  .router`). A name bound more than once in the file by any initializer is
// not call-resolved either (no scope analysis, like collectConstStrings).
function buildRequireResolver(commentMasked, masked) {
  const requiresByVarName = new Map();
  // `const tasks = require('./routes').tasks;` -- REQUIRE_PATTERN matches it
  // by its `require('./routes')` prefix, which alone would read the barrel
  // itself and never follow `.tasks`. A binding whose whole initializer is
  // one member of an inline relative require keeps the member as its export
  // name. Set and cleared alongside requiresByVarName, so whichever binding
  // of a name is written last decides both.
  const memberRequiresByVarName = new Map();
  for (const match of commentMasked.matchAll(REQUIRE_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    requiresByVarName.set(match[1], match[3]);
    memberRequiresByVarName.delete(match[1]);
    const valueStart = match.index + match[0].indexOf('=') + 1;
    const valueEnd = rightHandSideEnd(masked, valueStart);
    const inline = INLINE_REQUIRE_ARG_PATTERN.exec(commentMasked.slice(valueStart, valueEnd).trim());
    if (!inline || !inline[3] || !inline[2].startsWith('.')) continue;
    if (INITIALIZER_CONTINUATION_PATTERN.test(masked.slice(valueEnd))) continue;
    memberRequiresByVarName.set(match[1], { requirePath: inline[2], exportName: inline[3] });
  }
  const destructuredRequiresByVarName = new Map();
  for (const match of commentMasked.matchAll(DESTRUCTURED_REQUIRE_PATTERN)) {
    if (!matchIsLive(match, masked) || !match[3].startsWith('.')) continue;
    for (const { local, key } of destructuredNames(match[1])) {
      destructuredRequiresByVarName.set(local, { requirePath: match[3], exportName: key });
    }
  }
  function resolveDirect(text) {
    const inline = INLINE_REQUIRE_ARG_PATTERN.exec(text);
    if (inline) return { requirePath: inline[2], exportName: inline[3] || null };
    if (IDENTIFIER_ARG_PATTERN.test(text)) {
      if (memberRequiresByVarName.has(text)) return memberRequiresByVarName.get(text);
      if (requiresByVarName.get(text)) return { requirePath: requiresByVarName.get(text), exportName: null };
      return destructuredRequiresByVarName.get(text) || null;
    }
    const member = MEMBER_ARG_PATTERN.exec(text);
    if (member) {
      const requirePath = requiresByVarName.get(member[1]);
      return requirePath && requirePath.startsWith('.') ? { requirePath, exportName: member[2] } : null;
    }
    return null;
  }
  // Call-bound names are resolved with resolveDirect, never with the final
  // resolver, which is what keeps the lookup one level deep.
  const callBoundByVarName = new Map();
  const bindingCounts = new Map();
  for (const match of commentMasked.matchAll(BINDING_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    const name = match[2];
    bindingCounts.set(name, (bindingCounts.get(name) || 0) + 1);
    const valueStart = match.index + match[0].length - match[3].length;
    const valueEnd = rightHandSideEnd(masked, valueStart);
    // An initializer carried on by the next line (`make(db)` / `  .router`)
    // is more than the one call.
    if (INITIALIZER_CONTINUATION_PATTERN.test(masked.slice(valueEnd))) continue;
    const called = resolveRelativeCall(commentMasked, masked, [valueStart, valueEnd], resolveDirect);
    if (called) callBoundByVarName.set(name, called);
  }
  for (const name of [...callBoundByVarName.keys()]) {
    if (bindingCounts.get(name) > 1) callBoundByVarName.delete(name);
  }
  function resolve(text) {
    // Checked first: `const r = require('./x').tasks(db)` also matches
    // REQUIRE_PATTERN by its prefix, which would drop the `.tasks` member.
    if (callBoundByVarName.has(text)) return callBoundByVarName.get(text);
    return resolveDirect(text);
  }
  // The lookup without call-bound names, for a caller unwrapping a call
  // itself: a call of a call-bound name is two calls deep.
  resolve.direct = resolveDirect;
  return resolve;
}

// The file (and named export) behind an expression that is exactly one call
// of a relative-require form `resolve` reads -- makeTasksRouter(db),
// routes.tasks(db), a destructured name called, require('./x')(db),
// require('./x').member(db) -- or null. `[start, end)` is the expression's
// range in the source. The callee is the text before the paren that the
// expression's closing paren matches, found by depth on `masked` so nothing
// inside the call's own arguments (parens, commas, quotes, comments) is
// read. Relative-only: express.json(), helmet(), swaggerUi.setup(doc) and
// rateLimit({...}) are never router files in this repo. Only one call is
// unwrapped -- make(db)(x) and wrap(make(db)) are not resolved.
function resolveRelativeCall(commentMasked, masked, [start, end], resolve) {
  const raw = commentMasked.slice(start, end);
  const text = raw.trim();
  if (!text.endsWith(')')) return null;
  const textStart = start + raw.indexOf(text);
  let depth = 0;
  let open = textStart + text.length - 1;
  for (; open >= textStart; open -= 1) {
    const ch = masked[open];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (open < textStart || masked[open] !== '(') return null;
  const callee = resolve(commentMasked.slice(textStart, open).trim());
  return callee && callee.requirePath.startsWith('.') ? callee : null;
}

// Splits an object literal's body at its top-level commas. `bodyStart` is
// the index right after the opening "{"; depth is counted on `masked` like
// splitTopLevelArgs. Returns [start, end) pairs, or null when it never closes.
function splitObjectEntries(masked, bodyStart) {
  const entries = [];
  let depth = 0;
  let start = bodyStart;
  for (let i = bodyStart; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === '}') {
      if (depth === 0) {
        entries.push([start, i]);
        return entries;
      }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      entries.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

// The end of a right-hand side starting at `valueStart`: the statement's `;`
// or its line end at depth 0, counted on `masked`.
function rightHandSideEnd(masked, valueStart) {
  let depth = 0;
  let end = valueStart;
  for (; end < masked.length; end += 1) {
    const ch = masked[end];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && (ch === ';' || (ch === '\n' && masked.slice(valueStart, end).trim() !== ''))) break;
  }
  return end;
}

// The body start (index right after the "{") of every object literal that
// sets this file's exports, in source order: `module.exports = {` (or
// `module.exports = exports = {`) and each object-literal argument after the
// first of `Object.assign(module.exports, { ... })` / `Object.assign(exports,
// { ... })`. Matched on the full mask, so commented-out or quoted text is
// never read.
function exportObjectBodies(masked) {
  const bodies = [];
  for (const match of masked.matchAll(MODULE_EXPORTS_OBJECT_PATTERN)) bodies.push(match.index + match[0].length);
  for (const match of masked.matchAll(OBJECT_ASSIGN_EXPORTS_PATTERN)) {
    const args = splitTopLevelArgs(masked, match.index + match[0].indexOf('(') + 1) || [];
    for (const [start, end] of args.slice(1)) {
      const open = start + masked.slice(start, end).search(/\S/);
      if (masked[open] === '{') bodies.push(open + 1);
    }
  }
  return bodies.sort((a, b) => a - b);
}

// Reads how a file hands on its exports to other files. Returns { declared,
// hops }: `hops` is the list of relative requires that may stand behind
// `exportName` (or behind the whole module when `exportName` is null), in
// the order the collector should prefer them, each { requirePath,
// exportName, via }; `declared` is true when the file names `exportName`
// itself (an own object entry or an `exports.name =` assignment), whatever
// its value.
//  - via 'named': `module.exports = { name: require('./x') }`, `{ name }` /
//    `{ name: local }` with the local bound by (or destructured from) a
//    relative require, the same entries in an `Object.assign(module.exports,
//    { ... })` / `Object.assign(exports, { ... })` argument, and
//    `exports.name = ...` / `module.exports.name = ...` with the same
//    right-hand sides.
//  - via 'spread': the name is not an own entry of any exports object, but an
//    object has `...require('./x')` / `...local` entries; one hop per spread,
//    the last-written first (later entries win in JavaScript). An own entry
//    always beats a spread here, wherever it is written.
//  - via 'module': the file's only `module.exports = ` statement is a
//    relative require, a local bound by one, or one member of either; the
//    hop keeps `exportName`. With a member (`module.exports =
//    require('./x').routers`) only a whole-module lookup is answered -- a
//    named export of a member would be two levels deep.
// Matched on comment-masked source and checked live against the full mask,
// so a commented-out or quoted export is ignored.
function analyzeExports(source, exportName) {
  const { masked: commentMasked } = maskComments(source);
  const { masked } = maskStringLiterals(source);
  const resolve = buildRequireResolver(commentMasked, masked);
  const relative = (text) => {
    const resolved = resolve(text.trim());
    return resolved && resolved.requirePath.startsWith('.') ? resolved : null;
  };
  let declared = false;
  const spreads = [];

  for (const bodyStart of exportObjectBodies(masked)) {
    const entries = splitObjectEntries(masked, bodyStart) || [];
    for (const [start, end] of entries) {
      const text = commentMasked.slice(start, end).trim();
      if (text.startsWith('...')) {
        const spread = relative(text.slice(3));
        // Only a whole module can be spread by name; `...require('./x').sub`
        // would be two levels deep.
        if (spread && !spread.exportName) spreads.push({ requirePath: spread.requirePath, exportName, via: 'spread' });
        continue;
      }
      const entry = EXPORT_ENTRY_PATTERN.exec(text);
      if (!entry || exportName === null || (entry[1] || entry[3]) !== exportName) continue;
      declared = true;
      // Shorthand `{ name }` reads the local of the same name.
      const found = relative(entry[4] === undefined ? exportName : entry[4]);
      if (found) return { declared, hops: [{ ...found, via: 'named' }] };
    }
  }
  for (const match of masked.matchAll(EXPORT_ASSIGNMENT_PATTERN)) {
    if (match[1] !== exportName) continue;
    declared = true;
    const valueStart = match.index + match[0].length;
    const found = relative(commentMasked.slice(valueStart, rightHandSideEnd(masked, valueStart)));
    if (found) return { declared, hops: [{ ...found, via: 'named' }] };
  }
  if (declared) return { declared, hops: [] };

  const hops = exportName === null ? [] : spreads.reverse();
  const wholeModule = [...masked.matchAll(WHOLE_MODULE_EXPORT_PATTERN)];
  if (wholeModule.length === 1) {
    const valueStart = wholeModule[0].index + wholeModule[0][0].length;
    const found = relative(commentMasked.slice(valueStart, rightHandSideEnd(masked, valueStart)));
    if (found && exportName === null) hops.push({ ...found, via: 'module' });
    else if (found && !found.exportName) hops.push({ requirePath: found.requirePath, exportName, via: 'module' });
  }
  return { declared, hops };
}

// Every relative require that may stand behind a file's export `exportName`
// (null: behind the module as a whole) -- see analyzeExports.
function findExportHops(source, exportName) {
  return analyzeExports(source, exportName).hops;
}

// Whether a file names the export `exportName` itself -- see analyzeExports.
function declaresExport(source, exportName) {
  return analyzeExports(source, exportName).declared;
}

// Where a file's named export `exportName` comes from when the file
// re-exports that one name from another file (a barrel): { requirePath,
// exportName } of the relative require behind it, or null -- the name is not
// exported that way, e.g. `module.exports = { router }` with the router
// built in this same file. Spread and whole-module barrels are answered by
// findExportHops.
function findExportedRequire(source, exportName) {
  const named = findExportHops(source, exportName).find((hop) => hop.via === 'named');
  return named ? { requirePath: named.requirePath, exportName: named.exportName } : null;
}

// Classifies every live app|router.use(...) call in source order, including
// a .use( chained onto another use(/verb call's closing paren. Each entry is
// { index, mount, warn }: `mount` is { prefix, requirePath[, exportName] } or null, and
// `warn` is true when the call's prefix cannot be read statically (so the
// router is reported by findUnparsedRoutes instead of being mounted at a
// wrong path). The first argument decides the prefix, the last decides the
// router, and anything between them is middleware of any shape:
//   - a quoted string literal, or a const bound to one -> that prefix;
//   - a name collectUnresolvablePrefixNames flags, an inline expression
//     (`API + '/v1'`, `a || b`), a regex or an escaped string -> warn;
//   - anything else (identifier, member, call, inline function), or a single
//     argument -> no prefix, i.e. '' -- kept only for a relative require,
//     since a prefixless app.use(x) is far more often plain middleware and a
//     bare package (helmet, cors) is never a router file in this repo. A
//     relative middleware module is still followed and contributes no routes.
// A first argument opening with a backtick or "[" yields neither on a call
// written directly on app|router: it is already reported by
// UNPARSED_MOUNT_PATTERN. That pattern cannot see a chained .use(, so there
// the same first argument warns here instead. A call whose last argument is
// not a require-bound identifier, a member of or a name destructured from a
// relative require, an inline require, or one call of a relative one of
// those (a router factory -- see resolveRouter) has no router to mount
// (express.json(), an unbound name).
function analyzeUseCalls(commentMasked, masked) {
  const constStringsByVarName = collectConstStrings(commentMasked, masked);
  const unresolvablePrefixNames = collectUnresolvablePrefixNames(commentMasked, masked);

  // The file (and named export) the router argument comes from, or null.
  // `[start, end)` is the argument's range in the source. Besides the forms
  // buildRequireResolver reads (a local bound to a factory call among them),
  // the argument may itself be one call of such a form -- a router factory
  // called inline, see resolveRelativeCall -- which resolves to the same
  // file, since the factory's router.<verb> calls are written there.
  const resolveRequire = buildRequireResolver(commentMasked, masked);
  function resolveRouter([start, end]) {
    const direct = resolveRequire(commentMasked.slice(start, end).trim());
    return direct || resolveRelativeCall(commentMasked, masked, [start, end], resolveRequire.direct);
  }

  // 'skip' (reported elsewhere), 'warn', or { prefix } with prefix null when
  // the first argument is middleware rather than a prefix.
  function resolvePrefix(argText, maskedArgText) {
    if (/^[`[]/.test(argText)) return 'skip';
    const literal = STRING_LITERAL_ARG_PATTERN.exec(argText);
    if (literal) return { prefix: literal[2] };
    if (IDENTIFIER_ARG_PATTERN.test(argText)) {
      if (constStringsByVarName.has(argText)) return { prefix: constStringsByVarName.get(argText) };
      return unresolvablePrefixNames.has(argText) ? 'warn' : { prefix: null };
    }
    if (INLINE_FUNCTION_ARG_PATTERN.test(argText)) return { prefix: null };
    if (/^['"/]/.test(argText) || hasTopLevelOperator(maskedArgText)) return 'warn';
    return { prefix: null };
  }

  const calls = [];
  function analyzeCall(index, callArgs, isChained) {
    const args = callArgs.slice();
    const argText = ([start, end]) => commentMasked.slice(start, end).trim();
    // A trailing comma -- app.use(a || b,) -- is not another argument.
    if (argText(args[args.length - 1]) === '') args.pop();
    if (args.length > 0) {
      const router = resolveRouter(args[args.length - 1]);
      const requirePath = router && router.requirePath;
      // exportName is only set when the router is one named export of the
      // required file, so a whole-module mount stays { prefix, requirePath }.
      const target = router && router.exportName ? { requirePath, exportName: router.exportName } : { requirePath };
      // A single argument is the router (or middleware), never a prefix.
      const resolved = args.length < 2
        ? { prefix: null }
        : resolvePrefix(argText(args[0]), masked.slice(args[0][0], args[0][1]));
      let mount = null;
      let warn = resolved === 'warn' || (resolved === 'skip' && isChained);
      if (typeof resolved === 'object' && requirePath) {
        if (resolved.prefix !== null) mount = { prefix: resolved.prefix, ...target };
        else if (requirePath.startsWith('.')) mount = { prefix: '', ...target };
      }
      // Safety net: a relative-require router must never vanish with neither
      // a mount nor a warning (the "skip" case is warned by its own pattern).
      if (!mount && !warn && resolved !== 'skip' && requirePath && requirePath.startsWith('.')) warn = true;
      calls.push({ index, mount, warn });
    }
  }
  // Walked on the fully masked source, so a call quoted in a string or
  // sitting in a comment is never analyzed. A use( chained onto a verb call
  // (app.get('/health', h).use('/api', r)) is read like one chained onto use(.
  for (const call of collectCallChains(masked)) {
    if (call.name === 'use') analyzeCall(call.index, call.args, call.isChained);
  }
  calls.sort((a, b) => a.index - b.index);
  return calls;
}

// Finds router/app verb calls whose path is anything but a string literal or
// a const bound to one, plus .route() calls and app|router.use() mounts
// whose path/prefix argument is a template literal (or, for a mount, a
// variable collectUnresolvablePrefixNames can't resolve or an inline
// expression such as `API + '/v1'`), in either a router
// file or an app entry file's source text. Returns explicit warning findings
// (type 'unparsed-route') instead of the silent skip described above, so a
// doc-drift report can say "this route exists but couldn't be checked"
// rather than reading as full, verified coverage. Matched against
// commentMasked (not raw source) for the same reason every other detection
// regex in this file is: a commented-out/dead-code occurrence must not be
// reported as a real, live one.
function findUnparsedRoutes(source) {
  const { masked: commentMasked } = maskComments(source);
  const { masked } = maskStringLiterals(source);
  const findings = [];

  // A head or chained verb call whose path is not a string literal or a
  // const bound to one (see classifyVerbCalls), at the call's own line.
  for (const call of classifyVerbCalls(commentMasked, masked)) {
    if (!call.warn) continue;
    findings.push({
      type: 'unparsed-route',
      method: call.method,
      line: lineNumberAt(commentMasked, call.index),
      reason: 'route exists but path could not be statically resolved',
    });
  }
  for (const match of commentMasked.matchAll(UNPARSED_ROUTE_CALL_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    findings.push({
      type: 'unparsed-route',
      method: null,
      line: lineNumberAt(commentMasked, match.index),
      reason: 'route exists but path could not be statically resolved',
    });
  }
  for (const match of commentMasked.matchAll(UNPARSED_MOUNT_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    findings.push({
      type: 'unparsed-route',
      method: 'MOUNT',
      line: lineNumberAt(commentMasked, match.index),
      reason: 'mount exists but prefix could not be statically resolved',
    });
  }
  // A mount whose prefix is a variable collectUnresolvablePrefixNames can't
  // resolve, or an inline expression -- app.use(API + '/v1', r),
  // app.use(process.env.P || '/api', r) -- is never mounted (see
  // analyzeUseCalls), so it is reported here instead of vanishing. The
  // expression is not evaluated, only reported.
  for (const call of analyzeUseCalls(commentMasked, masked)) {
    if (!call.warn) continue;
    findings.push({
      type: 'unparsed-route',
      method: 'MOUNT',
      line: lineNumberAt(commentMasked, call.index),
      reason: 'mount exists but prefix could not be statically resolved',
    });
  }

  return findings;
}

module.exports = { parseRouterSource, parseAppEntrySource, findUnparsedRoutes, findExportedRequire, findExportHops, declaresExport };
