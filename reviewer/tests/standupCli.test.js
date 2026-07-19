const { runStandupCli, parseStandupArgs } = require('../src/standupCli');

function makeStream() {
  let buffer = '';
  return { write: (chunk) => { buffer += chunk; }, get text() { return buffer; } };
}

describe('parseStandupArgs', () => {
  it('defaults repo to cwd and everything else to null/unset', () => {
    const args = parseStandupArgs([]);
    expect(args.repo).toBe(process.cwd());
    expect(args.owner).toBeNull();
    expect(args.ghRepo).toBeNull();
    expect(args.since).toBeNull();
    expect(args.token).toBeNull();
    expect(args.out).toBeNull();
  });

  it('parses --owner, --gh-repo, --repo, --since, --token, and --out', () => {
    const args = parseStandupArgs([
      '--owner', 'vijaykrishnaas',
      '--gh-repo', 'lead-agent-toolkit',
      '--repo', '/tmp/repo',
      '--since', '2026-07-17T00:00:00.000Z',
      '--token', 'gh-token',
      '--out', 'standup.md',
    ]);
    expect(args.owner).toBe('vijaykrishnaas');
    expect(args.ghRepo).toBe('lead-agent-toolkit');
    expect(args.repo).toBe('/tmp/repo');
    expect(args.since).toBe('2026-07-17T00:00:00.000Z');
    expect(args.token).toBe('gh-token');
    expect(args.out).toBe('standup.md');
  });

  it('throws when --owner is given without --gh-repo', () => {
    expect(() => parseStandupArgs(['--owner', 'o'])).toThrow(/--owner and --gh-repo must both be given/);
  });

  it('throws when --gh-repo is given without --owner', () => {
    expect(() => parseStandupArgs(['--gh-repo', 'r'])).toThrow(/--owner and --gh-repo must both be given/);
  });

  it('throws on an unrecognized flag', () => {
    expect(() => parseStandupArgs(['--bogus'])).toThrow(/Unrecognized argument/);
  });

  it('throws when --owner is the last token, instead of silently omitting it', () => {
    expect(() => parseStandupArgs(['--repo', '.', '--owner'])).toThrow(/Missing value for --owner/);
  });

  it('throws when --out is the last token, instead of silently falling back to stdout', () => {
    expect(() => parseStandupArgs(['--owner', 'o', '--gh-repo', 'r', '--out'])).toThrow(/Missing value for --out/);
  });

  it('throws when --owner is immediately followed by another flag, instead of silently omitting it', () => {
    // Regression: the header comment on VALUE_FLAGS already claimed this
    // case ("or immediately followed by another flag") was handled, but the
    // parser only ever checked for `undefined` (the last-token case) —
    // `--owner --gh-repo r` silently took '--gh-repo' as --owner's own
    // value and dropped --gh-repo's real value, producing a mismatched
    // owner/repo pairing with no error.
    expect(() => parseStandupArgs(['--owner', '--gh-repo', 'r'])).toThrow(/Missing value for --owner/);
  });
});

describe('runStandupCli', () => {
  it('prints the generated report to stdout', async () => {
    const generateStandup = jest.fn().mockResolvedValue('# Standup\n\nNo commits or pull requests in the last 24h.\n');
    const stdout = makeStream();

    const exitCode = await runStandupCli([], { generateStandup, env: {}, stdout, stderr: makeStream() });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain('# Standup');
    expect(generateStandup).toHaveBeenCalledWith(
      expect.objectContaining({ repo: process.cwd(), owner: null, ghRepo: null, since: undefined }),
      expect.objectContaining({ token: null }),
    );
  });

  it('passes owner/ghRepo/since through to generateStandup', async () => {
    const generateStandup = jest.fn().mockResolvedValue('# Standup\n');

    await runStandupCli(
      ['--owner', 'o', '--gh-repo', 'r', '--since', '2026-07-17T00:00:00.000Z'],
      { generateStandup, stdout: makeStream(), stderr: makeStream() },
    );

    expect(generateStandup).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'o', ghRepo: 'r', since: '2026-07-17T00:00:00.000Z' }),
      expect.anything(),
    );
  });

  it('resolves the token from --token over GITHUB_TOKEN env', async () => {
    const generateStandup = jest.fn().mockResolvedValue('# Standup\n');

    await runStandupCli(
      ['--owner', 'o', '--gh-repo', 'r', '--token', 'flag-token'],
      { generateStandup, env: { GITHUB_TOKEN: 'env-token' }, stdout: makeStream(), stderr: makeStream() },
    );

    expect(generateStandup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ token: 'flag-token' }));
  });

  it('falls back to GITHUB_TOKEN from env when --token is not given', async () => {
    const generateStandup = jest.fn().mockResolvedValue('# Standup\n');

    await runStandupCli(
      ['--owner', 'o', '--gh-repo', 'r'],
      { generateStandup, env: { GITHUB_TOKEN: 'env-token' }, stdout: makeStream(), stderr: makeStream() },
    );

    expect(generateStandup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ token: 'env-token' }));
  });

  it('writes the report to a file when --out is given, instead of stdout', async () => {
    const generateStandup = jest.fn().mockResolvedValue('# Standup\n');
    const writeFile = jest.fn();
    const stdout = makeStream();

    const exitCode = await runStandupCli(
      ['--out', 'standup.md'],
      { generateStandup, writeFile, stdout, stderr: makeStream() },
    );

    expect(exitCode).toBe(0);
    expect(stdout.text).toBe('');
    expect(writeFile).toHaveBeenCalledWith('standup.md', '# Standup\n');
  });

  it('returns exit code 1 and writes to stderr on invalid args, without calling generateStandup', async () => {
    const generateStandup = jest.fn();
    const stderr = makeStream();

    const exitCode = await runStandupCli(['--owner', 'o'], { generateStandup, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(generateStandup).not.toHaveBeenCalled();
    expect(stderr.text).toContain('--owner and --gh-repo must both be given');
  });

  it('returns exit code 1 and writes to stderr when generateStandup throws, instead of crashing', async () => {
    const generateStandup = jest.fn().mockRejectedValue(new Error('git log failed'));
    const stderr = makeStream();

    const exitCode = await runStandupCli([], { generateStandup, stdout: makeStream(), stderr });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to generate standup report');
    expect(stderr.text).toContain('git log failed');
  });

  it('returns exit code 1 and writes to stderr when writing the report fails, instead of crashing', async () => {
    const generateStandup = jest.fn().mockResolvedValue('# Standup\n');
    const writeFile = () => {
      throw new Error('ENOENT: no such file or directory');
    };
    const stderr = makeStream();

    const exitCode = await runStandupCli(
      ['--out', '/no/such/dir/standup.md'],
      { generateStandup, writeFile, stdout: makeStream(), stderr },
    );

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Failed to write report output');
  });
});
