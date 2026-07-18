const fs = require('fs');
const path = require('path');
const { runReviewPrCli, parseReviewPrArgs } = require('../src/reviewPrCli');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function makeStream() {
  let buffer = '';
  return { write: (chunk) => { buffer += chunk; }, get text() { return buffer; } };
}

const BASE_ARGV = ['--owner', 'vijaykrishnaas', '--gh-repo', 'lead-agent-toolkit', '--pr', '42', 'base..head'];

describe('parseReviewPrArgs', () => {
  it('parses owner/gh-repo/pr and the base..head range', () => {
    const args = parseReviewPrArgs(BASE_ARGV);
    expect(args.owner).toBe('vijaykrishnaas');
    expect(args.ghRepo).toBe('lead-agent-toolkit');
    expect(args.pr).toBe('42');
    expect(args.range).toBe('base..head');
    expect(args.noPost).toBe(false);
    expect(args.out).toBeNull();
  });

  it('parses --repo, --config, --token, --out, and --no-post flags', () => {
    const args = parseReviewPrArgs([
      ...BASE_ARGV,
      '--repo', '/tmp/repo',
      '--config', '/tmp/rules.yaml',
      '--token', 'gh-token',
      '--out', 'report.md',
      '--no-post',
    ]);
    expect(args.repo).toBe('/tmp/repo');
    expect(args.config).toBe('/tmp/rules.yaml');
    expect(args.token).toBe('gh-token');
    expect(args.out).toBe('report.md');
    expect(args.noPost).toBe(true);
  });

  it('throws when --owner is missing', () => {
    expect(() => parseReviewPrArgs(['--gh-repo', 'r', '--pr', '1', 'a..b'])).toThrow(/--owner/);
  });

  it('throws when --gh-repo is missing', () => {
    expect(() => parseReviewPrArgs(['--owner', 'o', '--pr', '1', 'a..b'])).toThrow(/--gh-repo/);
  });

  it('throws when --pr is missing', () => {
    expect(() => parseReviewPrArgs(['--owner', 'o', '--gh-repo', 'r', 'a..b'])).toThrow(/--pr/);
  });

  it('throws when the range is missing', () => {
    expect(() => parseReviewPrArgs(['--owner', 'o', '--gh-repo', 'r', '--pr', '1'])).toThrow(/Missing.*range/);
  });

  it('throws when the range has no ".."', () => {
    expect(() => parseReviewPrArgs(['--owner', 'o', '--gh-repo', 'r', '--pr', '1', 'abc123'])).toThrow(/Invalid range/);
  });

  it('throws on an unrecognized flag', () => {
    expect(() => parseReviewPrArgs([...BASE_ARGV, '--bogus'])).toThrow(/Unrecognized argument/);
  });
});

describe('runReviewPrCli', () => {
  function basePassingDeps(overrides = {}) {
    return {
      execGit: () => loadFixture('clean.diff'),
      postReviewComment: jest.fn().mockResolvedValue({ id: 1 }),
      env: { GITHUB_TOKEN: 'env-token' },
      stdout: makeStream(),
      stderr: makeStream(),
      ...overrides,
    };
  }

  it('prints the report and posts it as a PR comment using GITHUB_TOKEN from env', async () => {
    const deps = basePassingDeps();

    const exitCode = await runReviewPrCli(BASE_ARGV, deps);

    expect(exitCode).toBe(0);
    expect(deps.stdout.text).toContain('# Code Review Report');
    expect(deps.postReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'env-token',
        owner: 'vijaykrishnaas',
        repo: 'lead-agent-toolkit',
        prNumber: '42',
        body: expect.stringContaining('# Code Review Report'),
      }),
      deps,
    );
    expect(deps.stdout.text).toContain('Posted review comment to vijaykrishnaas/lead-agent-toolkit#42.');
  });

  it('prefers an explicit --token flag over GITHUB_TOKEN from env', async () => {
    const deps = basePassingDeps();

    await runReviewPrCli([...BASE_ARGV, '--token', 'flag-token'], deps);

    expect(deps.postReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'flag-token' }),
      deps,
    );
  });

  it('writes the report to a file when --out is given, still posts the same content', async () => {
    const writeFile = jest.fn();
    const deps = basePassingDeps({ writeFile });

    const exitCode = await runReviewPrCli([...BASE_ARGV, '--out', 'report.md'], deps);

    expect(exitCode).toBe(0);
    expect(deps.stdout.text).not.toContain('# Code Review Report');
    expect(writeFile).toHaveBeenCalledWith('report.md', expect.stringContaining('# Code Review Report'));
    expect(deps.postReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('# Code Review Report') }),
      deps,
    );
  });

  it('skips posting entirely when --no-post is given', async () => {
    const deps = basePassingDeps();

    const exitCode = await runReviewPrCli([...BASE_ARGV, '--no-post'], deps);

    expect(exitCode).toBe(0);
    expect(deps.postReviewComment).not.toHaveBeenCalled();
    expect(deps.stdout.text).not.toContain('Posted review comment');
  });

  it('returns exit code 1 and writes to stderr on invalid args, without calling git', async () => {
    const execGit = jest.fn();
    const stderr = makeStream();

    const exitCode = await runReviewPrCli(['--owner', 'o'], { execGit, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(execGit).not.toHaveBeenCalled();
    expect(stderr.text).toContain('--gh-repo');
  });

  it('returns exit code 1 and writes to stderr when git diff fails, instead of crashing', async () => {
    const stderr = makeStream();
    const execGit = () => {
      throw new Error("unknown revision 'bogus'");
    };

    const exitCode = await runReviewPrCli(BASE_ARGV, { execGit, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('git diff failed');
  });

  it('returns exit code 1 and writes to stderr when the rule config is malformed, instead of crashing', async () => {
    const stderr = makeStream();
    const loadRules = () => {
      throw new Error('bad yaml');
    };

    const exitCode = await runReviewPrCli(BASE_ARGV, {
      execGit: () => loadFixture('clean.diff'),
      loadRules,
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to load review-rules config');
  });

  it('returns exit code 1 and writes to stderr when reviewing the diff throws, instead of crashing', async () => {
    const stderr = makeStream();
    const reviewDiff = () => {
      throw new Error('unexpected rule failure');
    };

    const exitCode = await runReviewPrCli(BASE_ARGV, {
      execGit: () => loadFixture('clean.diff'),
      reviewDiff,
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Review failed');
  });

  it('returns exit code 1 and writes to stderr when writing the report fails (e.g. bad --out path), instead of crashing', async () => {
    const stderr = makeStream();
    const writeFile = () => {
      throw new Error('ENOENT: no such file or directory');
    };

    const exitCode = await runReviewPrCli([...BASE_ARGV, '--out', '/no/such/dir/report.md'], {
      execGit: () => loadFixture('clean.diff'),
      writeFile,
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to write report output');
  });

  it('returns exit code 1 and writes to stderr when postReviewComment rejects, instead of crashing', async () => {
    const stderr = makeStream();
    const postReviewComment = jest.fn().mockRejectedValue(new Error('GitHub API request failed (500): oops'));

    const exitCode = await runReviewPrCli(BASE_ARGV, {
      execGit: () => loadFixture('clean.diff'),
      postReviewComment,
      env: { GITHUB_TOKEN: 'env-token' },
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to post PR comment');
    expect(stderr.text).toContain('GitHub API request failed');
  });

  it('returns exit code 1 and writes to stderr when no token is available and posting is not skipped', async () => {
    const stderr = makeStream();

    const exitCode = await runReviewPrCli(BASE_ARGV, {
      execGit: () => loadFixture('clean.diff'),
      env: {},
      stdout: makeStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to post PR comment');
    expect(stderr.text).toContain('token');
  });

  it('passes --config through to loadRules', async () => {
    const loadRules = jest.fn(() => []);

    await runReviewPrCli([...BASE_ARGV, '--config', '/tmp/custom.yaml', '--no-post'], {
      execGit: () => loadFixture('clean.diff'),
      loadRules,
      stdout: makeStream(),
      stderr: makeStream(),
    });

    expect(loadRules).toHaveBeenCalledWith('/tmp/custom.yaml');
  });
});
