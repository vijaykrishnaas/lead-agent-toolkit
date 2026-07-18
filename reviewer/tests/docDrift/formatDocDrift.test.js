const { formatDocDriftReport } = require('../../src/docDrift/formatDocDrift');

describe('formatDocDriftReport', () => {
  it('reports no drift when both lists are empty', () => {
    const report = formatDocDriftReport({ missingFromSpec: [], missingFromCode: [] });
    expect(report).toContain('# Doc Drift Report');
    expect(report).toContain('No drift detected');
  });

  it('lists routes missing from the spec and paths missing from the code separately', () => {
    const result = {
      missingFromSpec: [{ method: 'POST', path: '/api/tasks' }],
      missingFromCode: [{ method: 'DELETE', path: '/api/tasks/{id}' }],
    };

    const report = formatDocDriftReport(result);

    expect(report).toContain('## Routes missing from OpenAPI spec (1)');
    expect(report).toContain('- `POST /api/tasks`');
    expect(report).toContain('## OpenAPI paths missing from routes (1)');
    expect(report).toContain('- `DELETE /api/tasks/{id}`');
  });

  it('marks an empty side as "_None._" when the other side has entries', () => {
    const result = {
      missingFromSpec: [{ method: 'POST', path: '/api/tasks' }],
      missingFromCode: [],
    };

    const report = formatDocDriftReport(result);
    expect(report).toContain('## OpenAPI paths missing from routes (0)');
    expect(report).toContain('_None._');
  });

  it('includes app/openapi source paths in the header when given', () => {
    const report = formatDocDriftReport(
      { missingFromSpec: [], missingFromCode: [] },
      { app: 'src/app.js', openapi: 'openapi.yaml' },
    );

    expect(report).toContain('**Routes source:** `src/app.js`');
    expect(report).toContain('**OpenAPI spec:** `openapi.yaml`');
  });
});
