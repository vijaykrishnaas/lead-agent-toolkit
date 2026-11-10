const { maskStringLiterals, maskComments } = require('../utils/maskStringLiterals');
const { HTTP_METHODS } = require('./httpMethods');
const VERB_ALTERNATION = HTTP_METHODS.join('|');
// The path must start with "/" or "*": app.get('env') / req.app.get('title')
// is Express's settings getter (same receiver, same verb name), not a route.
const METHOD_CALL_PATTERN = new RegExp(`\\b(?:router|app)\\.(${VERB_ALTERNATION})\\(\\s*(['"])([/*].*?)\\2`, 'g');
// Matches both app.use(prefix, router) (in the app entry file) and
// router.use(prefix, subRouter) (a router file mounting a *nested* router
// under a sub-prefix) — the same mount syntax, just on a different receiver
// — so a nested router's own routes aren't dropped when this same parser is
// run recursively against router files, not just the app entry file.
const MOUNT_PATTERN = /\b(?:router|app)\.use\(\s*(['"])(.*?)\1\s*,\s*(?:[A-Za-z_$][\w$.]*(?:\((?:[^()]|\([^()]*\))*\))?\s*,\s*)*(?:require\(\s*(['"])(.*?)\3\s*\)(?:\.[A-Za-z_$][\w$]*)?|([A-Za-z_$][\w$]*))\s*\)/g;
// The same mount with no prefix argument at all -- app.use(router),
// app.use(mw, router), app.use(require('./x')) -- which Express mounts at
// the receiver's own path. The first argument must be an identifier or a
// require(), so a quoted prefix (MOUNT_PATTERN's case) never matches here.
const PREFIXLESS_MOUNT_PATTERN = /\b(?:router|app)\.use\(\s*(?:[A-Za-z_$][\w$.]*(?:\((?:[^()]|\([^()]*\))*\))?\s*,\s*)*(?:require\(\s*(['"])(.*?)\1\s*\)(?:\.[A-Za-z_$][\w$]*)?|([A-Za-z_$][\w$]*))\s*\)/g;
// `const API = '/api';` -- a prefix held in a variable. Only a `const` whose
// whole initializer is one string literal counts (not `'/a' + x`, not a
// reassignable let/var), so the resolved prefix is exactly what Express sees.
const CONST_STRING_PATTERN = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\\\n]*)\2\s*(?:;|$)/gm;
const FIRST_ARG_IDENTIFIER_PATTERN = /\.use\(\s*([A-Za-z_$][\w$]*)\s*,/;
// Any `const|let|var x = <initializer>` binding, capturing the initializer's
// first line. Used to tell a prefix variable the parser cannot resolve
// (`const API = process.env.API_PREFIX || '/api'`, a template literal, a
// reassignable `let API = '/api'`) from middleware (see
// collectUnresolvablePrefixNames).
const BINDING_PATTERN = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]*)/g;
// Initializers that make a binding middleware-shaped rather than a prefix:
// a function/arrow expression, or a call -- require('./auth'), and factory
// calls such as rateLimit({...}) / express.json() / new Limiter(), which is
// how most middleware is built.
const MIDDLEWARE_INITIALIZER_PATTERN = /^(?:(?:async\s+)?function\b|(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:new\s+)?[A-Za-z_$][\w$.]*\s*\()/;
const REQUIRE_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])(.*?)\2\s*\)/g;
// Matches router.route('/path') / app.route('/path') so its chained
// .<verb>(...) calls (e.g. .get(fn).post(fn)) can be found separately —
// METHOD_CALL_PATTERN can't see them because the verb call isn't preceded
// by "router."/"app." directly, only by the ").route(...)" chain.
const ROUTE_CALL_PATTERN = /\.route\(\s*(['"])(.*?)\1\s*\)/g;
// `all` is matched too: `.all(mw)` is the per-path middleware hook in a route
// chain, not an HTTP verb, so it adds no route — but the chain continues past
// it, and stopping there dropped every real verb chained after it.
const CHAINED_VERB_START_PATTERN = new RegExp(`^\\.(${VERB_ALTERNATION}|all)\\(`);

// Mirror of METHOD_CALL_PATTERN/ROUTE_CALL_PATTERN/MOUNT_PATTERN above, but
// matching a template-literal-delimited (backtick) path/prefix argument
// instead of a quoted one. A template literal can embed an interpolated
// expression (e.g. `` `/api/${version}/things` ``) whose actual runtime
// value can't be determined by static text scanning, so none of the three
// quote-only patterns above ever match it -- the route/mount silently never
// appeared on the code side of the comparison at all (AUDIT.md F8). These
// patterns only need to detect *that* such a call exists and where, not
// resolve its path, so they stop right after the opening backtick. An array
// path (`['/a', '/b']`) is the same silent drop, so `[` is matched too.
const UNPARSED_METHOD_CALL_PATTERN = new RegExp(`\\b(?:router|app)\\.(${VERB_ALTERNATION})\\(\\s*[\`\\[]`, 'g');
const UNPARSED_ROUTE_CALL_PATTERN = /\.route\(\s*[`[]/g;
const UNPARSED_MOUNT_PATTERN = /\b(?:router|app)\.use\(\s*[`[]/g;

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

// Extracts { method, path } route entries from a single Express router file's
// source text (e.g. tasks.routes.js). Only router.<verb>(path, ...) calls
// and router.route(path).<verb>(...) chains count as routes — router.use
// (middleware) and similar are ignored because neither pattern matches
// anything but a recognized HTTP verb.
//
// All top-level route-detection regexes (METHOD_CALL_PATTERN here,
// MOUNT_PATTERN/REQUIRE_PATTERN in parseAppEntrySource) are matched against
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
  for (const match of commentMasked.matchAll(METHOD_CALL_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    routes.push({ method: match[1].toUpperCase(), path: match[3] });
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
  const constStrings = new Set();
  for (const match of commentMasked.matchAll(CONST_STRING_PATTERN)) {
    if (matchIsLive(match, masked)) constStrings.add(match[1]);
  }
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

// The identifier in first position of a use(...) call with two or more
// arguments, or null.
function firstArgIdentifier(mountText) {
  const firstArg = FIRST_ARG_IDENTIFIER_PATTERN.exec(mountText);
  return firstArg ? firstArg[1] : null;
}

// Extracts the routes defined directly on the app/router object (e.g.
// app.get('/health', ...)) plus its own app.use|router.use(prefix, router)
// mounts from an Express source file's text (the app entry file, e.g.
// app.js, or a router file that itself mounts a nested sub-router),
// resolving each mount's router variable back to the file it was
// require()'d from. Any middleware args between the prefix and the router
// (e.g. app.use(prefix, authMiddleware, router)) are tolerated — only the
// final identifier before the closing paren is treated as the router. The
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

  const requiresByVarName = new Map();
  for (const match of commentMasked.matchAll(REQUIRE_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    requiresByVarName.set(match[1], match[3]);
  }

  const constStringsByVarName = new Map();
  for (const match of commentMasked.matchAll(CONST_STRING_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    constStringsByVarName.set(match[1], match[3]);
  }

  const unresolvablePrefixNames = collectUnresolvablePrefixNames(commentMasked, masked);

  const mounts = [];
  for (const match of commentMasked.matchAll(MOUNT_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    const [, , prefix, , inlineRequirePath, varName] = match;
    const requirePath = inlineRequirePath || requiresByVarName.get(varName);
    if (requirePath) mounts.push({ prefix, requirePath, index: match.index });
  }

  // A prefixless app.use(x) is far more often plain middleware than a router,
  // so only a relative require is kept: a bare package (helmet, cors) is
  // never a router file in this repo. A relative middleware module is still
  // followed, and simply contributes no routes.
  for (const match of commentMasked.matchAll(PREFIXLESS_MOUNT_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    const [, , inlineRequirePath, varName] = match;
    const requirePath = inlineRequirePath || requiresByVarName.get(varName);
    if (!requirePath) continue;
    // app.use(API, router) with `const API = '/api'` has the same shape as
    // app.use(mw, router); without this lookup the router was mounted at ''
    // and every one of its routes reported under the wrong path.
    const firstArg = firstArgIdentifier(match[0]);
    if (firstArg && constStringsByVarName.has(firstArg)) {
      mounts.push({ prefix: constStringsByVarName.get(firstArg), requirePath, index: match.index });
    } else if (firstArg && unresolvablePrefixNames.has(firstArg)) {
      // Reported by findUnparsedRoutes rather than mounted at a wrong prefix.
      continue;
    } else if (requirePath.startsWith('.')) {
      mounts.push({ prefix: '', requirePath, index: match.index });
    }
  }
  // Keep source order across the two passes, so a route list reads the way
  // the file mounts it.
  mounts.sort((a, b) => a.index - b.index);
  for (const mount of mounts) delete mount.index;

  return { directRoutes, mounts };
}

// Finds router/app verb calls, .route() calls, and app|router.use() mounts
// whose path/prefix argument is a template literal (or, for a mount, a
// variable collectUnresolvablePrefixNames can't resolve), in either a router
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

  for (const match of commentMasked.matchAll(UNPARSED_METHOD_CALL_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    findings.push({
      type: 'unparsed-route',
      method: match[1].toUpperCase(),
      line: lineNumberAt(commentMasked, match.index),
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
  const unresolvablePrefixNames = collectUnresolvablePrefixNames(commentMasked, masked);
  for (const match of commentMasked.matchAll(PREFIXLESS_MOUNT_PATTERN)) {
    if (!matchIsLive(match, masked)) continue;
    const firstArg = firstArgIdentifier(match[0]);
    if (!firstArg || !unresolvablePrefixNames.has(firstArg)) continue;
    findings.push({
      type: 'unparsed-route',
      method: 'MOUNT',
      line: lineNumberAt(commentMasked, match.index),
      reason: 'mount exists but prefix could not be statically resolved',
    });
  }

  return findings;
}

module.exports = { parseRouterSource, parseAppEntrySource, findUnparsedRoutes };
