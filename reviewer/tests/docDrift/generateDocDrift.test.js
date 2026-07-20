const { generateDocDrift } = require('../../src/docDrift/generateDocDrift');

describe('generateDocDrift', () => {
  it('wires collectExpressRoutes, spec parsing, comparison, and formatting together', () => {
    const collectExpressRoutes = jest.fn(() => ({ routes: [{ method: 'GET', path: '/api/tasks' }], unparsedRoutes: [] }));
    const readOpenApiFile = jest.fn(() => 'raw yaml');
    const parseOpenApiSpec = jest.fn(() => [{ method: 'GET', path: '/api/tasks' }]);

    const report = generateDocDrift(
      { appEntryPath: '/repo/src/app.js', openapiPath: '/repo/openapi.yaml' },
      { collectExpressRoutes, readOpenApiFile, parseOpenApiSpec },
    );

    expect(collectExpressRoutes).toHaveBeenCalledWith(
      { appEntryPath: '/repo/src/app.js' },
      expect.objectContaining({ collectExpressRoutes, readOpenApiFile, parseOpenApiSpec }),
    );
    expect(readOpenApiFile).toHaveBeenCalledWith('/repo/openapi.yaml');
    expect(parseOpenApiSpec).toHaveBeenCalledWith('raw yaml');
    expect(report).toContain('No drift detected');
    expect(report).toContain('**Routes source:** `/repo/src/app.js`');
    expect(report).toContain('**OpenAPI spec:** `/repo/openapi.yaml`');
  });

  it('surfaces a real mismatch end to end', () => {
    const collectExpressRoutes = () => ({ routes: [{ method: 'POST', path: '/api/tasks' }], unparsedRoutes: [] });
    const readOpenApiFile = () => '';
    const parseOpenApiSpec = () => [];

    const report = generateDocDrift(
      { appEntryPath: '/app.js', openapiPath: '/openapi.yaml' },
      { collectExpressRoutes, readOpenApiFile, parseOpenApiSpec },
    );

    expect(report).toContain('## Routes missing from OpenAPI spec (1)');
    expect(report).toContain('- `POST /api/tasks`');
  });

  it('surfaces unparsed-route findings end to end, and does not report "No drift detected" when one exists', () => {
    // AUDIT.md F8: a template-literal route must not be silently invisible
    // -- even with zero missingFromSpec/missingFromCode entries, the report
    // must not claim full, verified coverage.
    const collectExpressRoutes = () => ({
      routes: [{ method: 'GET', path: '/api/tasks' }],
      unparsedRoutes: [
        {
          type: 'unparsed-route',
          method: 'GET',
          line: 12,
          reason: 'route exists but path could not be statically resolved',
          file: '/repo/src/routes/tasks.routes.js',
        },
      ],
    });
    const readOpenApiFile = () => '';
    const parseOpenApiSpec = () => [{ method: 'GET', path: '/api/tasks' }];

    const report = generateDocDrift(
      { appEntryPath: '/app.js', openapiPath: '/openapi.yaml' },
      { collectExpressRoutes, readOpenApiFile, parseOpenApiSpec },
    );

    expect(report).not.toContain('No drift detected');
    expect(report).toContain('## Unparsed routes — could not be statically verified (1)');
    expect(report).toContain('- `/repo/src/routes/tasks.routes.js:12` (GET — route exists but path could not be statically resolved)');
  });
});
