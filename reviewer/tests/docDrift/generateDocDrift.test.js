const { generateDocDrift } = require('../../src/docDrift/generateDocDrift');

describe('generateDocDrift', () => {
  it('wires collectExpressRoutes, spec parsing, comparison, and formatting together', () => {
    const collectExpressRoutes = jest.fn(() => [{ method: 'GET', path: '/api/tasks' }]);
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
    const collectExpressRoutes = () => [{ method: 'POST', path: '/api/tasks' }];
    const readOpenApiFile = () => '';
    const parseOpenApiSpec = () => [];

    const report = generateDocDrift(
      { appEntryPath: '/app.js', openapiPath: '/openapi.yaml' },
      { collectExpressRoutes, readOpenApiFile, parseOpenApiSpec },
    );

    expect(report).toContain('## Routes missing from OpenAPI spec (1)');
    expect(report).toContain('- `POST /api/tasks`');
  });
});
