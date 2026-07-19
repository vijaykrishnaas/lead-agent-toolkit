const {
  postReviewComment, tokenFromEnv, GITHUB_API_URL, BOT_COMMENT_PREFIX, computeBotCommentMarker,
} = require('../../src/github/postReviewComment');

function makeResponse({ ok = true, status = 201, json = {}, text = '' } = {}) {
  return { ok, status, json: async () => json, text: async () => text };
}

// Every postReviewComment call first GETs the existing comment list to look
// for a prior bot comment; tests that don't care about that search just want
// it to report "none found" so the POST-path assertions below still apply.
function noExistingComments() {
  return makeResponse({ json: [] });
}

describe('postReviewComment', () => {
  const baseArgs = { token: 'gh-token', owner: 'vijaykrishnaas', repo: 'lead-agent-toolkit', prNumber: 42, body: '# Code Review Report' };
  const marker = computeBotCommentMarker(baseArgs.token, baseArgs.owner, baseArgs.repo, baseArgs.prNumber);

  it('POSTs a marker-prefixed body to the PR comments endpoint with an auth header when no prior bot comment exists', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(noExistingComments())
      .mockResolvedValueOnce(makeResponse({ json: { id: 1, html_url: 'https://github.com/.../comments/1' } }));

    const result = await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/42/comments`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gh-token',
          Accept: 'application/vnd.github+json',
        }),
        body: JSON.stringify({ body: `${marker}\n# Code Review Report` }),
      }),
    );
    expect(result).toEqual({ id: 1, html_url: 'https://github.com/.../comments/1', updated: false });
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

  it('throws with status and body text when searching for a prior bot comment fails', async () => {
    const request = jest.fn().mockResolvedValue(makeResponse({ ok: false, status: 404, text: 'Not Found' }));

    await expect(postReviewComment(baseArgs, { request })).rejects.toThrow(/404.*Not Found/s);
  });

  it('throws with status and body text when the GitHub API responds with an error while posting/updating', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(noExistingComments())
      .mockResolvedValueOnce(makeResponse({ ok: false, status: 500, text: 'Server Error' }));

    await expect(postReviewComment(baseArgs, { request })).rejects.toThrow(/500.*Server Error/s);
  });

  it('URL-encodes owner/repo/prNumber so a stray "/" cannot redirect the request to a different API path', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(noExistingComments())
      .mockResolvedValueOnce(makeResponse({ json: { id: 1 } }));

    await postReviewComment({ ...baseArgs, owner: 'attacker/other-owner', repo: 'other-repo' }, { request });

    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/attacker%2Fother-owner/other-repo/issues/42/comments`,
      expect.anything(),
    );
  });

  it('PATCHes the existing bot comment in place instead of creating a new one when one is found', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        json: [
          { id: 100, body: 'a human comment, no marker' },
          { id: 101, body: `${marker}\nstale report` },
        ],
      }))
      .mockResolvedValueOnce(makeResponse({ json: { id: 101 } }));

    const result = await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/comments/101`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ body: `${marker}\n# Code Review Report` }),
      }),
    );
    expect(result).toEqual({ id: 101, updated: true });
  });

  it('updates the most recent bot comment when more than one exists on the PR', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        json: [
          { id: 10, body: `${marker}\nfirst run` },
          { id: 20, body: `${marker}\nsecond run` },
        ],
      }))
      .mockResolvedValueOnce(makeResponse({ json: { id: 20 } }));

    await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/comments/20`,
      expect.anything(),
    );
  });

  it('pages through the full comment history (not just the first page) to find a prior bot comment', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i, body: `human comment ${i}` }));
    const request = jest.fn()
      .mockResolvedValueOnce(makeResponse({ json: fullPage }))
      .mockResolvedValueOnce(makeResponse({ json: [{ id: 999, body: `${marker}\nold report` }] }))
      .mockResolvedValueOnce(makeResponse({ json: { id: 999 } }));

    await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/comments/999`,
      expect.anything(),
    );
  });

  it('does not treat a comment that merely contains the marker mid-body (not at the start) as a prior bot comment', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(makeResponse({ json: [{ id: 5, body: `quoting the bot: ${marker}` }] }))
      .mockResolvedValueOnce(makeResponse({ json: { id: 6 } }));

    await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/42/comments`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not treat a spoofed comment using a fixed public prefix (no valid HMAC suffix) as a prior bot comment', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        json: [{ id: 7, body: `${BOT_COMMENT_PREFIX} -->\nfake report from a non-owning commenter` }],
      }))
      .mockResolvedValueOnce(makeResponse({ json: { id: 8 } }));

    await postReviewComment(baseArgs, { request });

    expect(request).toHaveBeenLastCalledWith(
      `${GITHUB_API_URL}/repos/vijaykrishnaas/lead-agent-toolkit/issues/42/comments`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('computeBotCommentMarker', () => {
  it('is deterministic for the same token/owner/repo/prNumber', () => {
    expect(computeBotCommentMarker('gh-token', 'o', 'r', 42)).toBe(computeBotCommentMarker('gh-token', 'o', 'r', 42));
  });

  it('differs when the token differs, so it cannot be guessed without the real credential', () => {
    expect(computeBotCommentMarker('gh-token', 'o', 'r', 42))
      .not.toBe(computeBotCommentMarker('a-different-token', 'o', 'r', 42));
  });

  it('differs across PRs/repos so a marker cannot be replayed from one PR onto another', () => {
    const base = computeBotCommentMarker('gh-token', 'o', 'r', 42);
    expect(computeBotCommentMarker('gh-token', 'o', 'r', 43)).not.toBe(base);
    expect(computeBotCommentMarker('gh-token', 'o', 'other-repo', 42)).not.toBe(base);
  });

  it('starts with the public prefix but is not equal to it alone', () => {
    const marker = computeBotCommentMarker('gh-token', 'o', 'r', 42);
    expect(marker.startsWith(BOT_COMMENT_PREFIX)).toBe(true);
    expect(marker).not.toBe(`${BOT_COMMENT_PREFIX} -->`);
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
