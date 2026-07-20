const fs = require('fs');
const path = require('path');
const { runCli, parseArgs } = require('../src/cli');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function makeStream() {
  let buffer = '';
  return { write: (chunk) => { buffer += chunk; }, get text() { return buffer; } };
}

describe('parseArgs', () => {
  it('parses a base..head range', () => {
    const args = parseArgs(['abc123..def456']);
    expect(args.range).toBe('abc123..def456');
    expect(args.base).toBe('abc123');
    expect(args.head).toBe('def456');
    expect(args.out).toBeNull();
  });

  it('parses --repo, --config, and --out flags', () => {
    const args = parseArgs(['a..b', '--repo', '/tmp/repo', '--config', '/tmp/rules.yaml', '--out', 'report.md']);
    expect(args.repo).toBe('/tmp/repo');
    expect(args.config).toBe('/tmp/rules.yaml');
    expect(args.out).toBe('report.md');
  });

  it('throws when the range is missing', () => {
    expect(() => parseArgs([])).toThrow(/Missing/);
  });

  it('throws when the range has no ".."', () => {
    expect(() => parseArgs(['abc123'])).toThrow(/Invalid range/);
  });

  it('throws on an unrecognized flag', () => {
    expect(() => parseArgs(['a..b', '--bogus'])).toThrow(/Unrecognized argument/);
  });

  it('throws when --out is the last token, instead of silently falling back to stdout', () => {
    expect(() => parseArgs(['a..b', '--out'])).toThrow(/Missing value for --out/);
  });

  it('throws when --out is immediately followed by another flag, instead of silently taking it as the value', () => {
    // Regression: only the "last token in argv" shape was validated;
    // `--out --repo <path>` silently took '--repo' as --out's own value and
    // dropped --repo's real value entirely, with no error.
    expect(() => parseArgs(['a..b', '--out', '--repo', '/tmp/repo'])).toThrow(/Missing value for --out/);
  });
});

describe('runCli', () => {
  it('writes a markdown report to stdout for a clean diff', () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const execGit = jest.fn(() => loadFixture('clean.diff'));

    const exitCode = runCli(['base..head'], { execGit, stdout, stderr });

    expect(exitCode).toBe(0);
    expect(execGit).toHaveBeenCalledWith(['diff', 'base..head'], process.cwd());
    expect(stdout.text).toContain('# Code Review Report');
    expect(stdout.text).toContain('**Risk:** none');
    expect(stderr.text).toBe('');
  });

  it('reports issues found by the default rule set for a real fixture diff', () => {
    const stdout = makeStream();
    const execGit = () => loadFixture('security-hardcoded-secret.diff');

    const exitCode = runCli(['base..head'], { execGit, stdout, stderr: makeStream() });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain('**Risk:** high');
    expect(stdout.text).toContain('## security');
  });

  it('writes the report to a file when --out is given instead of stdout', () => {
    const stdout = makeStream();
    const writeFile = jest.fn();
    const execGit = () => loadFixture('clean.diff');

    const exitCode = runCli(['base..head', '--out', 'report.md'], { execGit, writeFile, stdout, stderr: makeStream() });

    expect(exitCode).toBe(0);
    expect(stdout.text).toBe('');
    expect(writeFile).toHaveBeenCalledWith('report.md', expect.stringContaining('# Code Review Report'));
  });

  it('returns exit code 1 and writes to stderr on an invalid range, without calling git', () => {
    const stderr = makeStream();
    const execGit = jest.fn();

    const exitCode = runCli(['not-a-range'], { execGit, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(execGit).not.toHaveBeenCalled();
    expect(stderr.text).toContain('Invalid range');
  });

  it('returns exit code 1 and writes to stderr when git diff fails (e.g. bad ref)', () => {
    const stderr = makeStream();
    const execGit = () => {
      throw new Error("unknown revision 'bogus'");
    };

    const exitCode = runCli(['bogus..head'], { execGit, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('git diff failed');
    expect(stderr.text).toContain('bogus');
  });

  it('returns exit code 1 and writes to stderr when the rule config is malformed', () => {
    const stderr = makeStream();
    const execGit = () => loadFixture('clean.diff');
    const loadRules = () => {
      throw new Error('bad yaml');
    };

    const exitCode = runCli(['base..head'], { execGit, loadRules, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to load review-rules config');
  });

  it('returns exit code 1 and writes to stderr when writing the report fails (e.g. bad --out path), instead of crashing', () => {
    const stderr = makeStream();
    const execGit = () => loadFixture('clean.diff');
    const writeFile = () => {
      throw new Error('ENOENT: no such file or directory');
    };

    const exitCode = runCli(['base..head', '--out', '/no/such/dir/report.md'], {
      execGit,
      writeFile,
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to write report output');
    expect(stderr.text).toContain('ENOENT');
  });

  it('returns exit code 1 and writes to stderr when reviewing the diff throws, instead of crashing', () => {
    const stderr = makeStream();
    const execGit = () => loadFixture('clean.diff');
    const reviewDiff = () => {
      throw new Error('unexpected rule failure');
    };

    const exitCode = runCli(['base..head'], { execGit, reviewDiff, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Review failed');
    expect(stderr.text).toContain('unexpected rule failure');
  });

  it('resolves the head sha via git rev-parse and passes it through to reviewDiff as review options', () => {
    const reviewDiff = jest.fn(() => ({ risk: 'none', issues: [] }));
    const execGit = jest.fn((gitArgs) => {
      if (gitArgs[0] === 'rev-parse') return 'deadbeef\n';
      return loadFixture('clean.diff');
    });

    runCli(['base..head', '--repo', '/repo'], { execGit, reviewDiff, stdout: makeStream(), stderr: makeStream() });

    expect(execGit).toHaveBeenCalledWith(['rev-parse', 'head'], '/repo');
    expect(reviewDiff).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      { execGit, repo: '/repo', sha: 'deadbeef' },
    );
  });

  it('still produces a report when git rev-parse fails, falling back to no content-resolution options', () => {
    const stdout = makeStream();
    const execGit = jest.fn((gitArgs) => {
      if (gitArgs[0] === 'rev-parse') throw new Error('fatal: ambiguous argument');
      return loadFixture('clean.diff');
    });

    const exitCode = runCli(['base..head'], { execGit, stdout, stderr: makeStream() });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain('# Code Review Report');
  });

  it('passes --config through to loadRules', () => {
    const loadRules = jest.fn(() => []);
    const execGit = () => loadFixture('clean.diff');

    runCli(['base..head', '--config', '/tmp/custom.yaml'], {
      execGit,
      loadRules,
      stdout: makeStream(),
      stderr: makeStream(),
    });

    expect(loadRules).toHaveBeenCalledWith('/tmp/custom.yaml');
  });
});
