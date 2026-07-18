const { compareRoutes, normalizeRoutePath } = require('../../src/docDrift/compareRoutes');

describe('normalizeRoutePath', () => {
  it('converts an Express :param segment to OpenAPI {param} style', () => {
    expect(normalizeRoutePath('/api/users/:id')).toBe('/api/users/{id}');
  });

  it('converts multiple :param segments', () => {
    expect(normalizeRoutePath('/api/:a/:b')).toBe('/api/{a}/{b}');
  });

  it('strips a trailing slash but keeps a bare root path as "/"', () => {
    expect(normalizeRoutePath('/api/tasks/')).toBe('/api/tasks');
    expect(normalizeRoutePath('/')).toBe('/');
  });

  it('leaves an already-{param}-style path unchanged', () => {
    expect(normalizeRoutePath('/api/users/{id}')).toBe('/api/users/{id}');
  });
});

describe('compareRoutes', () => {
  it('reports no drift when code and spec routes match under normalization', () => {
    const codeRoutes = [{ method: 'GET', path: '/api/users/:id' }];
    const specRoutes = [{ method: 'GET', path: '/api/users/{id}' }];

    expect(compareRoutes(codeRoutes, specRoutes)).toEqual({ missingFromSpec: [], missingFromCode: [] });
  });

  it('matches methods case-insensitively', () => {
    const codeRoutes = [{ method: 'get', path: '/api/tasks' }];
    const specRoutes = [{ method: 'GET', path: '/api/tasks' }];

    expect(compareRoutes(codeRoutes, specRoutes)).toEqual({ missingFromSpec: [], missingFromCode: [] });
  });

  it('flags a code route with no matching spec entry as missingFromSpec', () => {
    const codeRoutes = [{ method: 'POST', path: '/api/tasks' }];
    const specRoutes = [];

    const result = compareRoutes(codeRoutes, specRoutes);
    expect(result.missingFromSpec).toEqual([{ method: 'POST', path: '/api/tasks' }]);
    expect(result.missingFromCode).toEqual([]);
  });

  it('flags a spec path with no matching code route as missingFromCode', () => {
    const codeRoutes = [];
    const specRoutes = [{ method: 'DELETE', path: '/api/tasks/{id}' }];

    const result = compareRoutes(codeRoutes, specRoutes);
    expect(result.missingFromCode).toEqual([{ method: 'DELETE', path: '/api/tasks/{id}' }]);
    expect(result.missingFromSpec).toEqual([]);
  });

  it('does not let one matching route silence a mismatch on a different route in the same comparison', () => {
    const codeRoutes = [
      { method: 'GET', path: '/api/tasks' },
      { method: 'POST', path: '/api/tasks' },
    ];
    const specRoutes = [{ method: 'GET', path: '/api/tasks' }];

    const result = compareRoutes(codeRoutes, specRoutes);
    expect(result.missingFromSpec).toEqual([{ method: 'POST', path: '/api/tasks' }]);
  });

  it('sorts results by method then path for stable output', () => {
    const codeRoutes = [
      { method: 'POST', path: '/api/b' },
      { method: 'GET', path: '/api/a' },
      { method: 'GET', path: '/api/b' },
    ];

    const result = compareRoutes(codeRoutes, []);
    expect(result.missingFromSpec).toEqual([
      { method: 'GET', path: '/api/a' },
      { method: 'GET', path: '/api/b' },
      { method: 'POST', path: '/api/b' },
    ]);
  });
});
