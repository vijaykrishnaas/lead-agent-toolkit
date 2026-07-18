const { generateStandup } = require('../../src/standup/generateStandup');

describe('generateStandup', () => {
  it('combines injected commits and pull requests into a per-author report', async () => {
    const collectCommits = jest.fn(() => [{ hash: 'abc1234567', author: 'Alice', date: '2026-07-18T09:00:00Z', message: 'Fix bug' }]);
    const collectPullRequests = jest.fn(async () => [{ number: 1, author: 'Alice', title: 'Fix bug PR', state: 'open' }]);
    const since = new Date('2026-07-17T00:00:00.000Z');

    const report = await generateStandup(
      { repo: '/repo', owner: 'o', ghRepo: 'r', since },
      { collectCommits, collectPullRequests },
    );

    expect(collectCommits).toHaveBeenCalledWith({ repo: '/repo', since }, expect.anything());
    expect(collectPullRequests).toHaveBeenCalledWith({ owner: 'o', repo: 'r', since }, expect.anything());
    expect(report).toContain('## Alice');
    expect(report).toContain('Fix bug');
    expect(report).toContain('Fix bug PR');
  });

  it('skips pull request collection when owner/ghRepo are not given', async () => {
    const collectCommits = jest.fn(() => []);
    const collectPullRequests = jest.fn();

    const report = await generateStandup({ repo: '/repo', since: new Date() }, { collectCommits, collectPullRequests });

    expect(collectPullRequests).not.toHaveBeenCalled();
    expect(report).toContain('No commits or pull requests in the last 24h.');
  });

  it('defaults since to the last 24 hours when not given', async () => {
    const collectCommits = jest.fn(() => []);

    await generateStandup({ repo: '/repo' }, { collectCommits });

    const [{ since }] = collectCommits.mock.calls[0];
    expect(since).toBeInstanceOf(Date);
    const ageMs = Date.now() - since.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(ageMs).toBeLessThan(24 * 60 * 60 * 1000 + 5000);
  });

  it('accepts an ISO string for since and normalizes it to a Date', async () => {
    const collectCommits = jest.fn(() => []);

    const report = await generateStandup({ repo: '/repo', since: '2026-07-17T00:00:00.000Z' }, { collectCommits });

    const [{ since }] = collectCommits.mock.calls[0];
    expect(since).toEqual(new Date('2026-07-17T00:00:00.000Z'));
    expect(report).toContain('**Since:** 2026-07-17T00:00:00.000Z');
  });
});
