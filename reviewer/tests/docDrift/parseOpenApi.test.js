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

  it('returns an empty array when the spec has no paths', () => {
    expect(parseOpenApiSpec('openapi: 3.0.3\ninfo:\n  title: x\n  version: "1.0"\n')).toEqual([]);
  });
});
