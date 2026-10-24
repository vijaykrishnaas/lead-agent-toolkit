const { parseOpenApiSpec } = require('../../src/docDrift/parseOpenApi');

describe('parseOpenApiSpec', () => {
  it('extracts one route per HTTP-verb key under each path', () => {
    const yamlText = `
paths:
  /api/users/{id}:
    get:
      summary: Get user
    put:
      summary: Update user
    delete:
      summary: Delete user
  /api/auth/login:
    post:
      summary: Log in
`;

    const routes = parseOpenApiSpec(yamlText);

    expect(routes).toEqual([
      { method: 'GET', path: '/api/users/{id}' },
      { method: 'PUT', path: '/api/users/{id}' },
      { method: 'DELETE', path: '/api/users/{id}' },
      { method: 'POST', path: '/api/auth/login' },
    ]);
  });

  it('ignores non-HTTP-verb keys under a path (parameters, summary, description)', () => {
    const yamlText = `
paths:
  /api/tasks:
    description: Task collection
    parameters:
      - name: unused
    get:
      summary: List tasks
`;

    expect(parseOpenApiSpec(yamlText)).toEqual([{ method: 'GET', path: '/api/tasks' }]);
  });

  it('recognizes the trace verb defined by OpenAPI 3.x', () => {
    expect(parseOpenApiSpec('paths:\n  /w:\n    trace:\n      summary: t\n')).toEqual([
      { method: 'TRACE', path: '/w' },
    ]);
  });

  it('returns an empty array when the spec has no paths', () => {
    expect(parseOpenApiSpec('openapi: 3.0.3\ninfo:\n  title: x\n  version: "1.0"\n')).toEqual([]);
  });

  it('prefixes paths with the Swagger 2 basePath', () => {
    expect(parseOpenApiSpec('swagger: "2.0"\nbasePath: /api\npaths:\n  /users:\n    get: {}\n')).toEqual([
      { method: 'GET', path: '/api/users' },
    ]);
  });

  it('prefixes paths with the path component of the first OpenAPI 3 server url', () => {
    const text = 'openapi: 3.0.0\nservers:\n  - url: https://x.example.com/api/v1/\npaths:\n  /users:\n    get: {}\n  /:\n    get: {}\n';
    expect(parseOpenApiSpec(text)).toEqual([
      { method: 'GET', path: '/api/v1/users' },
      { method: 'GET', path: '/api/v1' },
    ]);
  });

  it('adds no prefix for a root, host-only or templated server url', () => {
    const base = 'paths:\n  /users:\n    get: {}\n';
    for (const url of ['/', 'https://x.example.com', '{scheme}://x/{base}']) {
      expect(parseOpenApiSpec(`servers:\n  - url: "${url}"\n${base}`)).toEqual([{ method: 'GET', path: '/users' }]);
    }
  });
});
