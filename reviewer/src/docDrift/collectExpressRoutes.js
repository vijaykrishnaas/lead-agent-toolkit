const fs = require('fs');
const path = require('path');
const { parseAppEntrySource, findUnparsedRoutes, findExportedRequire } = require('./parseExpressRoutes');

// Joins a mount prefix (e.g. '/api/tasks') with a route path from inside that
// router (e.g. '/', '/:id') into one full path, without doubling or dropping
// the slash between them.
function joinPath(prefix, routePath) {
  const trimmedPrefix = prefix.replace(/\/$/, '');
  if (routePath === '/') return trimmedPrefix || '/';
  return trimmedPrefix + (routePath.startsWith('/') ? routePath : `/${routePath}`);
}

// Mirrors Node's require resolution for a relative router path: the exact
// file when it already names a .js/.cjs/.mjs file, else <path>.js, then <path>/index.js (a directory require). Falls
// back to the <path>.js guess when nothing is readable so the original
// ENOENT still surfaces for a genuinely missing router.
function resolveRouterPath(base, readFile) {
  const candidates = /\.[cm]?js$/.test(base) ? [base] : [`${base}.js`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      readFile(candidate);
      return candidate;
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
    }
  }
  return candidates[0];
}

// The file a relative require from a file in `fileDir` points at, or null
// when it is not a router source file in this repo:
//  - a bare specifier (e.g. 'swagger-ui-express') is an npm package;
//    resolving it as a path would throw ENOENT;
//  - a relative .json/.node require (config data, a native addon) is never a
//    router source file either; guessing <path>.js for it would throw ENOENT
//    and abort the whole run over a use() argument such as `cfg.mw` with
//    `const cfg = require('./config.json')`.
function resolveRequiredFile(fileDir, requirePath, readFile) {
  if (!requirePath.startsWith('.')) return null;
  if (/\.(?:json|node)$/.test(requirePath)) return null;
  return resolveRouterPath(path.resolve(fileDir, requirePath), readFile);
}

// Whether `filePath` can be read; only ENOENT counts as "no", any other
// read error still surfaces.
function isReadable(filePath, readFile) {
  try {
    readFile(filePath);
    return true;
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
    return false;
  }
}

// Recursively walks a source file's own direct routes and mounts, resolving
// each mount to its required file and recursing into *that* file too — a
// router file can itself mount a nested sub-router (router.use(prefix,
// subRouter)), and that nested router's routes must not be dropped just
// because only the top-level app entry file was ever walked for mounts.
// `ancestors` guards against an (unexpected but possible) require cycle
// between router files sending this into an infinite loop. It must only
// track the current root-to-node recursion path, not every file visited
// anywhere in the tree — the same router file legitimately gets required
// and mounted more than once from unrelated call sites (e.g. API
// versioning: the same router mounted under both '/api/v1/things' and
// '/api/v2/things'), and a whole-tree-shared visited set would silently
// drop the second mount's routes as if it were a cycle. Passing a fresh
// Set (current path + this file) to each child call keeps cycle detection
// scoped to genuine ancestor chains while leaving sibling branches
// independent.
// `exportName` is set when the mount reached this file through one named
// export (`routes.tasks`, `const { tasks } = require('./routes')`): if the
// file only re-exports that name from another file (a barrel -- see
// findExportedRequire), that file is collected instead, at the same prefix.
// A barrel hop is tracked in `ancestors` per file *and* export name, so a
// barrel legitimately passed through twice on one path (for two different
// exports) is not mistaken for a cycle while a self-referencing export still
// terminates. When the name is not re-exported that way, the file itself is
// collected, as before (`module.exports = { router }` with the routes
// defined in the same file). The same holds when the re-export's target is
// not readable as a .js file (`require('../config')` resolving to
// config.json, a native addon, a .ts file): a barrel member is only a guess
// at a router, so an unreadable target must not abort the run the way a
// directly mounted missing router does.
function collectFromFile(filePath, prefix, readFile, ancestors, exportName) {
  if (exportName) {
    const hopKey = `${filePath}\0${exportName}`;
    if (ancestors.has(hopKey)) return { routes: [], unparsedRoutes: [] };
    const reExport = findExportedRequire(readFile(filePath), exportName);
    const target = reExport && resolveRequiredFile(path.dirname(filePath), reExport.requirePath, readFile);
    if (target && isReadable(target, readFile)) {
      const hopAncestors = new Set(ancestors);
      hopAncestors.add(hopKey);
      return collectFromFile(target, prefix, readFile, hopAncestors, reExport.exportName);
    }
  }
  if (ancestors.has(filePath)) return { routes: [], unparsedRoutes: [] };
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(filePath);

  const source = readFile(filePath);
  const { directRoutes, mounts } = parseAppEntrySource(source);

  const routes = directRoutes.map((route) => ({ method: route.method, path: joinPath(prefix, route.path) }));
  const unparsedRoutes = findUnparsedRoutes(source).map((finding) => ({ ...finding, file: filePath }));

  const fileDir = path.dirname(filePath);
  for (const { prefix: mountPrefix, requirePath, exportName: mountExportName } of mounts) {
    const routerPath = resolveRequiredFile(fileDir, requirePath, readFile);
    if (!routerPath) continue;
    const nested = collectFromFile(routerPath, joinPath(prefix, mountPrefix), readFile, nextAncestors, mountExportName);
    routes.push(...nested.routes);
    unparsedRoutes.push(...nested.unparsedRoutes);
  }

  return { routes, unparsedRoutes };
}

// Walks an Express app entry file (e.g. app.js) and every router file it
// mounts — including any router file that itself mounts a further nested
// router — returning the full set of routes actually defined in the code
// ({ routes: [{ method, path }], unparsedRoutes: [{ type, method, line,
// reason, file }] }). unparsedRoutes carries every route/mount call found
// with a template-literal path/prefix that could not be statically resolved
// (see findUnparsedRoutes) -- a mount with an unresolvable prefix is not
// recursed into, since neither its own full path nor its nested routes'
// paths could be joined to anything meaningful. `deps.readFile` is
// injectable so tests never touch the real filesystem.
function collectExpressRoutes({ appEntryPath }, deps = {}) {
  const readFile = deps.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  return collectFromFile(appEntryPath, '', readFile, new Set());
}

module.exports = { collectExpressRoutes, joinPath };
