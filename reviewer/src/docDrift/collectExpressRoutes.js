const fs = require('fs');
const path = require('path');
const { parseRouterSource, parseAppEntrySource } = require('./parseExpressRoutes');

// Joins a mount prefix (e.g. '/api/tasks') with a route path from inside that
// router (e.g. '/', '/:id') into one full path, without doubling or dropping
// the slash between them.
function joinPath(prefix, routePath) {
  const trimmedPrefix = prefix.replace(/\/$/, '');
  if (routePath === '/') return trimmedPrefix || '/';
  return trimmedPrefix + (routePath.startsWith('/') ? routePath : `/${routePath}`);
}

// Walks an Express app entry file (e.g. app.js) and every router file it
// mounts, returning the full set of routes actually defined in the code:
// [{ method, path }]. `deps.readFile` is injectable so tests never touch the
// real filesystem.
function collectExpressRoutes({ appEntryPath }, deps = {}) {
  const readFile = deps.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));

  const appSource = readFile(appEntryPath);
  const { directRoutes, mounts } = parseAppEntrySource(appSource);

  const routes = [...directRoutes];
  const appDir = path.dirname(appEntryPath);
  for (const { prefix, requirePath } of mounts) {
    const routerPath = path.resolve(appDir, requirePath.endsWith('.js') ? requirePath : `${requirePath}.js`);
    const routerSource = readFile(routerPath);
    for (const route of parseRouterSource(routerSource)) {
      routes.push({ method: route.method, path: joinPath(prefix, route.path) });
    }
  }

  return routes;
}

module.exports = { collectExpressRoutes, joinPath };
