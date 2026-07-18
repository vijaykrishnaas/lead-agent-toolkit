const { postReviewComment, tokenFromEnv, GITHUB_API_URL } = require('../../src/github/postReviewComment');

function makeResponse({ ok = true, status = 201, json = {}, text = '' } = {}) {
  return { ok, status, json: async () => json, text: async () => text };
}

describe('postReviewComment', () => {
  const baseArgs = { token: 'gh-token', owner: 'vijaykrishnaas', repo: 'lead-agent-toolkit', prNumber: 42, body: '# Code Review Report' };

  it('POSTs the report body to the PR comments endpoint with an auth header', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ json: { id: 1, html_url: 'https://github.com/.../comments/1' } }));

    const result = await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/42/comments`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gh-token',
          Accept: 'application/vnd.github+json',
        }),
        body: JSON.stringify({ body: '# Code Review Report' }),
      }),
    );
    expect(result).toEqual({ id: 1, html_url: 'https://github.com/.../comments/1' });
  });

  it('throws without calling request when the token is missing', async () => {
    const request = jest.fn();

    await expect(postReviewComment({ ...baseArgs, token: undefined }, { request })).rejects.toThrow(/token/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws without calling request when owner/repo is missing', async () => {
    const request = jest.fn();

    await expect(postReviewComment({ ...baseArgs, repo: undefined }, { request })).rejects.toThrow(/owner\/repo/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws without calling request when prNumber is missing', async () => {
    const request = jest.fn();

    await expect(postReviewComment({ ...baseArgs, prNumber: undefined }, { request })).rejects.toThrow(/prNumber/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws with status and body text when the GitHub API responds with an error', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ ok: false, status: 404, text: 'Not Found' }));

    await expect(postReviewComment(baseArgs, { request })).rejects.toThrow(/404.*Not Found/s);
  });

  it('URL-encodes owner/repo/prNumber so a stray "/" cannot redirect the request to a different API path', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ json: { id: 1 } }));

    await postReviewComment({ ...baseArgs, owner: 'attacker/other-owner', repo: 'other-repo' }, { request });

    expect(request).toHaveBeenCalledWith(
      `${GITHUB_API_URL}/repos/attacker%2Fother-owner/other-repo/issues/42/comments`,
      expect.anything(),
    );
  });
});

describe('tokenFromEnv', () => {
  it('reads GITHUB_TOKEN from the given env object', () => {
    expect(tokenFromEnv({ GITHUB_TOKEN: 'abc123' })).toBe('abc123');
  });

  it('returns null when GITHUB_TOKEN is unset', () => {
    expect(tokenFromEnv({})).toBeNull();
  });
});
