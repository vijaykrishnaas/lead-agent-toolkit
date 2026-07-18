const yaml = require('js-yaml');
const { HTTP_METHODS } = require('./httpMethods');

// Extracts { method, path } route entries from an OpenAPI YAML document's
// `paths` map. Non-HTTP-verb keys under a path (parameters, summary,
// description, ...) are ignored.
function parseOpenApiSpec(yamlText) {
  const spec = yaml.load(yamlText) || {};
  const paths = spec.paths || {};

  const routes = [];
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      if (pathItem && Object.prototype.hasOwnProperty.call(pathItem, method)) {
        routes.push({ method: method.toUpperCase(), path: pathKey });
      }
    }
  }
  return routes;
}

module.exports = { parseOpenApiSpec };
