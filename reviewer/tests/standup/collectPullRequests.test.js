const { collectPullRequests } = require('../../src/standup/collectPullRequests');
const { GITHUB_API_URL } = require('../../src/github/postReviewComment');

function makeResponse({ ok = true, status = 200, json = [], text = '' } = {}) {
  return { ok, status, json: async () => json, text: async () => text };
}

describe('collectPullRequests', () => {
  const since = new Date('2026-07-17T00:00:00.000Z');

  it('fetches PRs and filters to those updated since the given date, mapping merged PRs to state "merged"', async () => {
    const pulls = [
      {
        number: 10,
        title: 'Recent PR',
        user: { login: 'alice' },
        state: 'open',
        merged_at: null,
        updated_at: '2026-07-18T10:00:00Z',
        html_url: 'https://github.com/o/r/pull/10',
      },
      {
        number: 9,
        title: 'Stale PR',
        user: { login: 'bob' },
        state: 'closed',
        merged_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        html_url: 'https://github.com/o/r/pull/9',
      },
      {
        number: 8,
        title: 'Merged recently',
        user: { login: 'alice' },
        state: 'closed',
        merged_at: '2026-07-17T12:00:00Z',
        updated_at: '2026-07-17T12:00:00Z',
        html_url: 'https://github.com/o/r/pull/8',
      },
    ];
    const request = jest.fn().mockResolvedValue(makeResponse({ json: pulls }));

    const prs = await collectPullRequests({ owner: 'o', repo: 'r', since }, { request });

    expect(request).toHaveBeenCalledWith(
      `${GITHUB_API_URL}/repos/o/r/pulls?state=all&sort=updated&direction=desc&per_page=50`,
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }) }),
    );
    expect(prs).toEqual([
      { number: 10, title: 'Recent PR', author: 'alice', state: 'open', updatedAt: '2026-07-18T10:00:00Z', url: 'https://github.com/o/r/pull/10' },
      { number: 8, title: 'Merged recently', author: 'alice', state: 'merged', updatedAt: '2026-07-17T12:00:00Z', url: 'https://github.com/o/r/pull/8' },
    ]);
  });

  it('includes an Authorization header when a token is given', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ json: [] }));

    await collectPullRequests({ owner: 'o', repo: 'r', since }, { request, token: 'gh-token' });

    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }) }),
    );
  });

  it('omits the Authorization header when no token is given', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ json: [] }));

    await collectPullRequests({ owner: 'o', repo: 'r', since }, { request });

    const [, options] = request.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('falls back to "Unknown" author when a PR has no user', async () => {
    const pulls = [
      { number: 1, title: 'No user', user: null, state: 'open', merged_at: null, updated_at: '2026-07-18T10:00:00Z', html_url: 'x' },
    ];
    const request = jest.fn().mockResolvedValue(makeResponse({ json: pulls }));

    const prs = await collectPullRequests({ owner: 'o', repo: 'r', since }, { request });

    expect(prs[0].author).toBe('Unknown');
  });

  it('throws without calling request when owner/repo is missing', async () => {
    const request = jest.fn();

    await expect(collectPullRequests({ owner: 'o', since }, { request })).rejects.toThrow(/owner\/repo/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws without calling request when since is missing', async () => {
    const request = jest.fn();

    await expect(collectPullRequests({ owner: 'o', repo: 'r' }, { request })).rejects.toThrow(/since/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws with status and body text when the GitHub API responds with an error', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ ok: false, status: 404, text: 'Not Found' }));

    await expect(collectPullRequests({ owner: 'o', repo: 'r', since }, { request })).rejects.toThrow(/404.*Not Found/s);
  });

  it('URL-encodes owner/repo so a stray "/" cannot redirect the request to a different API path', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ json: [] }));

    await collectPullRequests({ owner: 'attacker/other-owner', repo: 'r', since }, { request });

    expect(request).toHaveBeenCalledWith(
      `${GITHUB_API_URL}/repos/attacker%2Fother-owner/r/pulls?state=all&sort=updated&direction=desc&per_page=50`,
      expect.anything(),
    );
  });
});
