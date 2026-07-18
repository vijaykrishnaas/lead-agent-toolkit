const fs = require('fs');
const path = require('path');
const { parseAppEntrySource } = require('./parseExpressRoutes');

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
// `visited` guards against an (unexpected but possible) require cycle
// between router files sending this into an infinite loop.
function collectFromFile(filePath, prefix, readFile, visited) {
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  const source = readFile(filePath);
  const { directRoutes, mounts } = parseAppEntrySource(source);

  const routes = directRoutes.map((route) => ({ method: route.method, path: joinPath(prefix, route.path) }));

  const fileDir = path.dirname(filePath);
  for (const { prefix: mountPrefix, requirePath } of mounts) {
    const routerPath = path.resolve(fileDir, requirePath.endsWith('.js') ? requirePath : `${requirePath}.js`);
    routes.push(...collectFromFile(routerPath, joinPath(prefix, mountPrefix), readFile, visited));
  }

  return routes;
}

// Walks an Express app entry file (e.g. app.js) and every router file it
// mounts — including any router file that itself mounts a further nested
// router — returning the full set of routes actually defined in the code:
// [{ method, path }]. `deps.readFile` is injectable so tests never touch the
// real filesystem.
function collectExpressRoutes({ appEntryPath }, deps = {}) {
  const readFile = deps.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  return collectFromFile(appEntryPath, '', readFile, new Set());
}

module.exports = { collectExpressRoutes, joinPath };
