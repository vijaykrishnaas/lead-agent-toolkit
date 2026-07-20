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

  it('lists unparsed-route findings in their own section, with file, line, method and reason', () => {
    const result = {
      missingFromSpec: [],
      missingFromCode: [],
      unparsedRoutes: [
        {
          type: 'unparsed-route',
          method: 'GET',
          line: 12,
          reason: 'route exists but path could not be statically resolved',
          file: 'src/routes/tasks.routes.js',
        },
        {
          type: 'unparsed-route',
          method: 'MOUNT',
          line: 3,
          reason: 'mount exists but prefix could not be statically resolved',
          file: 'src/app.js',
        },
      ],
    };

    const report = formatDocDriftReport(result);

    expect(report).toContain('## Unparsed routes — could not be statically verified (2)');
    expect(report).toContain('- `src/routes/tasks.routes.js:12` (GET — route exists but path could not be statically resolved)');
    expect(report).toContain('- `src/app.js:3` (MOUNT — mount exists but prefix could not be statically resolved)');
  });

  it('does not report "No drift detected" when unparsedRoutes is non-empty, even if both mismatch lists are empty', () => {
    // AUDIT.md F8: an unresolved template-literal route must not read as
    // full, verified coverage just because no drift happened to be found
    // among the routes that *could* be checked.
    const result = {
      missingFromSpec: [],
      missingFromCode: [],
      unparsedRoutes: [
        {
          type: 'unparsed-route',
          method: 'GET',
          line: 5,
          reason: 'route exists but path could not be statically resolved',
          file: 'src/routes/things.routes.js',
        },
      ],
    };

    const report = formatDocDriftReport(result);

    expect(report).not.toContain('No drift detected');
    expect(report).toContain('## Routes missing from OpenAPI spec (0)');
    expect(report).toContain('## OpenAPI paths missing from routes (0)');
    expect(report).toContain('## Unparsed routes — could not be statically verified (1)');
  });

  it('omits the unparsed-routes section content but still shows "_None._" when unparsedRoutes is empty and drift exists elsewhere', () => {
    const result = {
      missingFromSpec: [{ method: 'POST', path: '/api/tasks' }],
      missingFromCode: [],
      unparsedRoutes: [],
    };

    const report = formatDocDriftReport(result);
    expect(report).toContain('## Unparsed routes — could not be statically verified (0)');
  });
});
