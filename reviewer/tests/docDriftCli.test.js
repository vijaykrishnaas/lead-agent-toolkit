const { runDocDriftCli, parseDocDriftArgs } = require('../src/docDriftCli');

function makeStream() {
  let buffer = '';
  return { write: (chunk) => { buffer += chunk; }, get text() { return buffer; } };
}

describe('parseDocDriftArgs', () => {
  it('parses --app and --openapi', () => {
    const args = parseDocDriftArgs(['--app', 'src/app.js', '--openapi', 'openapi.yaml']);
    expect(args.app).toBe('src/app.js');
    expect(args.openapi).toBe('openapi.yaml');
    expect(args.out).toBeNull();
  });

  it('parses --out', () => {
    const args = parseDocDriftArgs(['--app', 'a.js', '--openapi', 'o.yaml', '--out', 'report.md']);
    expect(args.out).toBe('report.md');
  });

  it('throws when --app is missing', () => {
    expect(() => parseDocDriftArgs(['--openapi', 'o.yaml'])).toThrow(/Missing required --app/);
  });

  it('throws when --openapi is missing', () => {
    expect(() => parseDocDriftArgs(['--app', 'a.js'])).toThrow(/Missing required --openapi/);
  });

  it('throws on an unrecognized flag', () => {
    expect(() => parseDocDriftArgs(['--app', 'a.js', '--openapi', 'o.yaml', '--bogus'])).toThrow(/Unrecognized argument/);
  });

  it('throws when --out is the last token, instead of silently falling back to stdout', () => {
    expect(() => parseDocDriftArgs(['--app', 'a.js', '--openapi', 'o.yaml', '--out'])).toThrow(/Missing value for --out/);
  });

  it('throws when --app is immediately followed by another flag, instead of silently taking it as the value', () => {
    expect(() => parseDocDriftArgs(['--app', '--openapi', 'o.yaml'])).toThrow(/Missing value for --app/);
  });
});

describe('runDocDriftCli', () => {
  it('writes the doc-drift report to stdout', () => {
    const stdout = makeStream();
    const generateDocDrift = jest.fn(() => '# Doc Drift Report\n\nNo drift detected.\n');

    const exitCode = runDocDriftCli(['--app', 'src/app.js', '--openapi', 'openapi.yaml'], {
      generateDocDrift,
      stdout,
      stderr: makeStream(),
    });

    expect(exitCode).toBe(0);
    expect(generateDocDrift).toHaveBeenCalledWith({ appEntryPath: 'src/app.js', openapiPath: 'openapi.yaml' }, expect.anything());
    expect(stdout.text).toContain('No drift detected');
  });

  it('writes the report to a file when --out is given instead of stdout', () => {
    const stdout = makeStream();
    const writeFile = jest.fn();
    const generateDocDrift = () => '# Doc Drift Report\n';

    const exitCode = runDocDriftCli(['--app', 'a.js', '--openapi', 'o.yaml', '--out', 'report.md'], {
      generateDocDrift,
      writeFile,
      stdout,
      stderr: makeStream(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toBe('');
    expect(writeFile).toHaveBeenCalledWith('report.md', expect.stringContaining('# Doc Drift Report'));
  });

  it('returns exit code 1 and writes to stderr when required args are missing, without generating a report', () => {
    const stderr = makeStream();
    const generateDocDrift = jest.fn();

    const exitCode = runDocDriftCli(['--app', 'a.js'], { generateDocDrift, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(generateDocDrift).not.toHaveBeenCalled();
    expect(stderr.text).toContain('Missing required --openapi');
  });

  it('returns exit code 1 and writes to stderr when generateDocDrift throws, instead of crashing', () => {
    const stderr = makeStream();
    const generateDocDrift = () => {
      throw new Error('ENOENT: no such file, app.js');
    };

    const exitCode = runDocDriftCli(['--app', 'a.js', '--openapi', 'o.yaml'], {
      generateDocDrift,
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Doc drift check failed');
    expect(stderr.text).toContain('ENOENT');
  });

  it('returns exit code 1 and writes to stderr when writing the report fails (e.g. bad --out path), instead of crashing', () => {
    const stderr = makeStream();
    const generateDocDrift = () => '# Doc Drift Report\n';
    const writeFile = () => {
      throw new Error('ENOENT: no such file or directory');
    };

    const exitCode = runDocDriftCli(['--app', 'a.js', '--openapi', 'o.yaml', '--out', '/no/such/dir/report.md'], {
      generateDocDrift,
      writeFile,
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to write report output');
    expect(stderr.text).toContain('ENOENT');
  });
});
