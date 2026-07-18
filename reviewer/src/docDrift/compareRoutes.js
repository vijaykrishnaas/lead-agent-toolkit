// Normalizes a route path for comparison across Express and OpenAPI param
// syntax (':id' -> '{id}') and trailing slashes, so the same real route
// written either way compares equal. Express param regex constraints (e.g.
// ':id(\d+)') have no OpenAPI equivalent, so the constraint is dropped along
// with the conversion -- otherwise ':id(\d+)' -> '{id}(\d+)' never matches
// its documented '{id}' counterpart, and the same real, fully-documented
// route is reported as drift on both sides.
function normalizeRoutePath(routePath) {
  const withBraceParams = routePath.replace(/:([A-Za-z_$][\w$]*)(\([^)]*\))?/g, '{$1}');
  if (withBraceParams === '/') return withBraceParams;
  return withBraceParams.replace(/\/$/, '');
}

function routeKey(route) {
  return `${route.method.toUpperCase()} ${normalizeRoutePath(route.path)}`;
}

// Compares the routes actually defined in code against the routes documented
// in an OpenAPI spec, returning:
// - missingFromSpec: routes present in code but not documented in the spec
// - missingFromCode: paths documented in the spec but not implemented in code
// Each list holds the original (non-normalized) route as it appeared on its
// own side, so the report reads naturally in either style.
function compareRoutes(codeRoutes, specRoutes) {
  const specKeys = new Set(specRoutes.map(routeKey));
  const codeKeys = new Set(codeRoutes.map(routeKey));

  const missingFromSpec = codeRoutes.filter((route) => !specKeys.has(routeKey(route)));
  const missingFromCode = specRoutes.filter((route) => !codeKeys.has(routeKey(route)));

  const byMethodThenPath = (a, b) => (a.method === b.method ? a.path.localeCompare(b.path) : a.method.localeCompare(b.method));
  missingFromSpec.sort(byMethodThenPath);
  missingFromCode.sort(byMethodThenPath);

  return { missingFromSpec, missingFromCode };
}

module.exports = { compareRoutes, normalizeRoutePath };
