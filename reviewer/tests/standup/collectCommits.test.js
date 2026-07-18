const { collectCommits } = require('../../src/standup/collectCommits');

const SEP = '\x1f';

function logLine({ hash, author, date, message }) {
  return [hash, author, date, message].join(SEP);
}

describe('collectCommits', () => {
  it('parses git log output into commit records', () => {
    const output = [
      logLine({ hash: 'abc123full', author: 'Alice', date: '2026-07-18T09:00:00+00:00', message: 'Fix bug' }),
      logLine({ hash: 'def456full', author: 'Bob', date: '2026-07-18T08:00:00+00:00', message: 'Add feature' }),
    ].join('\n');
    const execGit = jest.fn(() => output);

    const commits = collectCommits({ repo: '/repo', since: new Date('2026-07-17T00:00:00.000Z') }, { execGit });

    expect(execGit).toHaveBeenCalledWith(
      ['log', '--since=2026-07-17T00:00:00.000Z', '--pretty=format:%H\x1f%an\x1f%aI\x1f%s'],
      '/repo',
    );
    expect(commits).toEqual([
      { hash: 'abc123full', author: 'Alice', date: '2026-07-18T09:00:00+00:00', message: 'Fix bug' },
      { hash: 'def456full', author: 'Bob', date: '2026-07-18T08:00:00+00:00', message: 'Add feature' },
    ]);
  });

  it('returns an empty array when there are no commits in range', () => {
    const commits = collectCommits({ repo: '/repo', since: new Date() }, { execGit: () => '' });
    expect(commits).toEqual([]);
  });

  it('keeps a field-separator character inside the commit subject intact instead of truncating it', () => {
    const output = logLine({
      hash: 'abc123full',
      author: 'Alice',
      date: '2026-07-18T09:00:00+00:00',
      message: `weird${SEP}subject`,
    });

    const commits = collectCommits({ repo: '/repo', since: new Date() }, { execGit: () => output });

    expect(commits[0].message).toBe(`weird${SEP}subject`);
  });

  it('accepts an ISO string for since as well as a Date', () => {
    const execGit = jest.fn(() => '');

    collectCommits({ repo: '/repo', since: '2026-07-17T00:00:00.000Z' }, { execGit });

    expect(execGit).toHaveBeenCalledWith(expect.arrayContaining(['--since=2026-07-17T00:00:00.000Z']), '/repo');
  });

  it('throws when since is missing', () => {
    expect(() => collectCommits({ repo: '/repo' }, { execGit: jest.fn() })).toThrow(/since/i);
  });
});
