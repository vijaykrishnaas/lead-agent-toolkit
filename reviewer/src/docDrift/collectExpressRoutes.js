const fs = require('fs');
const path = require('path');
const { parseAppEntrySource, findUnparsedRoutes } = require('./parseExpressRoutes');

// Joins a mount prefix (e.g. '/api/tasks') with a route path from inside that
// router (e.g. '/', '/:id') into one full path, without doubling or dropping
// the slash between them.
function joinPath(prefix, routePath) {
  const trimmedPrefix = prefix.replace(/\/$/, '');
  if (routePath === '/') return trimmedPrefix || '/';
  return trimmedPrefix + (routePath.startsWith('/') ? routePath : `/${routePath}`);
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
function collectFromFile(filePath, prefix, readFile, ancestors) {
  if (ancestors.has(filePath)) return { routes: [], unparsedRoutes: [] };
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(filePath);

  const source = readFile(filePath);
  const { directRoutes, mounts } = parseAppEntrySource(source);

  const routes = directRoutes.map((route) => ({ method: route.method, path: joinPath(prefix, route.path) }));
  const unparsedRoutes = findUnparsedRoutes(source).map((finding) => ({ ...finding, file: filePath }));

  const fileDir = path.dirname(filePath);
  for (const { prefix: mountPrefix, requirePath } of mounts) {
    const routerPath = path.resolve(fileDir, requirePath.endsWith('.js') ? requirePath : `${requirePath}.js`);
    const nested = collectFromFile(routerPath, joinPath(prefix, mountPrefix), readFile, nextAncestors);
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
