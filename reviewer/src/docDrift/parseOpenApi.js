const yaml = require('js-yaml');
const { HTTP_METHODS } = require('./httpMethods');

// OpenAPI paths are relative to the spec's base path (Swagger 2 `basePath`,
// or the first OpenAPI 3 `servers[].url`'s path), while Express routes carry
// the full mounted path -- so ignoring it reports every route of a spec that
// uses one as drift on both sides. A templated server url can't be resolved
// statically, so it contributes no prefix.
function basePathOf(spec) {
  let base = '';
  if (typeof spec.basePath === 'string') {
    base = spec.basePath;
  } else if (Array.isArray(spec.servers) && spec.servers[0] && typeof spec.servers[0].url === 'string') {
    const url = spec.servers[0].url;
    if (url.includes('{')) return '';
    // A query string or fragment is never part of the path prefix.
    base = url.replace(/[?#].*$/, '').replace(/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/]*/, '');
  }
  base = base.replace(/\/+$/, '');
  return base && !base.startsWith('/') ? `/${base}` : base;
}

// Extracts { method, path } route entries from an OpenAPI YAML document's
// `paths` map. Non-HTTP-verb keys under a path (parameters, summary,
// description, ...) are ignored.
function parseOpenApiSpec(yamlText) {
  const spec = yaml.load(yamlText) || {};
  const paths = spec.paths || {};

  const basePath = basePathOf(spec);
  const routes = [];
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      if (pathItem && Object.prototype.hasOwnProperty.call(pathItem, method)) {
        routes.push({ method: method.toUpperCase(), path: pathKey === '/' && basePath ? basePath : `${basePath}${pathKey}` });
      }
    }
  }
  return routes;
}

module.exports = { parseOpenApiSpec };
