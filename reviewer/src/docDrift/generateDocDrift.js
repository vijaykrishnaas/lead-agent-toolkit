const fs = require('fs');
const { collectExpressRoutes } = require('./collectExpressRoutes');
const { parseOpenApiSpec } = require('./parseOpenApi');
const { compareRoutes } = require('./compareRoutes');
const { formatDocDriftReport } = require('./formatDocDrift');

// Generates a doc-drift markdown report comparing the Express routes actually
// defined under `options.appEntryPath` against the OpenAPI spec at
// `options.openapiPath`. All I/O is dependency-injected so tests never touch
// the real filesystem.
function generateDocDrift(options = {}, deps = {}) {
  const { appEntryPath, openapiPath } = options;
  const collectExpressRoutesFn = deps.collectExpressRoutes || collectExpressRoutes;
  const readOpenApiFile = deps.readOpenApiFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  const parseOpenApiSpecFn = deps.parseOpenApiSpec || parseOpenApiSpec;
  const compareRoutesFn = deps.compareRoutes || compareRoutes;
  const formatReport = deps.formatDocDriftReport || formatDocDriftReport;

  const { routes: codeRoutes, unparsedRoutes } = collectExpressRoutesFn({ appEntryPath }, deps);
  const specRoutes = parseOpenApiSpecFn(readOpenApiFile(openapiPath));
  const result = compareRoutesFn(codeRoutes, specRoutes);

  return formatReport({ ...result, unparsedRoutes }, { app: appEntryPath, openapi: openapiPath });
}

module.exports = { generateDocDrift };
