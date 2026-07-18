const GITHUB_API_URL = 'https://api.github.com';

// Hidden marker prepended to every comment this tool posts, so a repeat run
// against the same PR (review-pr is explicitly designed for repeat
// invocation) can find and update its own prior comment instead of always
// creating a new one — see TASKS.md task 16 / RETRO.md for the observed
// growing-comment-thread problem this closes.
const BOT_COMMENT_MARKER = '<!-- lead-agent-toolkit:review-pr -->';

const COMMENTS_PER_PAGE = 100;
// Safety cap on pages searched for a prior bot comment, so a PR with a
// pathologically large comment history can't loop indefinitely.
const MAX_COMMENT_SEARCH_PAGES = 20;

// Reads the token from the environment so callers never have to hardcode or
// pass secrets around explicitly; injectable `env` keeps this testable.
function tokenFromEnv(env = process.env) {
  return env.GITHUB_TOKEN || null;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lead-agent-toolkit-reviewer',
  };
}

// Finds this tool's own prior comment on the PR (identified by
// BOT_COMMENT_MARKER), if any. Issue comments are returned oldest-first by
// GitHub, so pages are walked forward and the last (most recent) match wins.
// Returns null if no prior bot comment is found.
async function findExistingBotComment({ token, owner, repo, prNumber }, request) {
  let found = null;
  for (let page = 1; page <= MAX_COMMENT_SEARCH_PAGES; page += 1) {
    const url = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      + `/issues/${encodeURIComponent(prNumber)}/comments?per_page=${COMMENTS_PER_PAGE}&page=${page}`;
    // eslint-disable-next-line no-await-in-loop
    const response = await request(url, { headers: authHeaders(token) });

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const text = await response.text();
      throw new Error(`GitHub API request failed (${response.status}): ${text}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const comments = await response.json();
    if (comments.length === 0) break;

    for (const comment of comments) {
      if (typeof comment.body === 'string' && comment.body.startsWith(BOT_COMMENT_MARKER)) {
        found = comment;
      }
    }

    if (comments.length < COMMENTS_PER_PAGE) break;
  }
  return found;
}

// Posts `body` (markdown) as an issue comment on the given PR, or updates
// this tool's own prior comment on that PR in place if one already exists
// (identified by BOT_COMMENT_MARKER), instead of always creating a new one.
// `deps.request` defaults to the global fetch (Node 20+) but is injectable
// so tests never hit the real GitHub API.
async function postReviewComment({ token, owner, repo, prNumber, body }, deps = {}) {
  const request = deps.request || fetch;

  if (!token) {
    throw new Error('Missing GitHub token — set GITHUB_TOKEN (or pass token explicitly).');
  }
  if (!owner || !repo) {
    throw new Error('Missing owner/repo — both are required to post a PR comment.');
  }
  if (!prNumber) {
    throw new Error('Missing prNumber — the PR number to comment on.');
  }

  const markedBody = `${BOT_COMMENT_MARKER}\n${body}`;
  const existing = await findExistingBotComment({ token, owner, repo, prNumber }, request);

  const url = existing
    ? `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      + `/issues/comments/${encodeURIComponent(existing.id)}`
    : `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      + `/issues/${encodeURIComponent(prNumber)}/comments`;

  const response = await request(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: markedBody }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }

  const comment = await response.json();
  // `updated` tells callers (e.g. the CLI's success message) whether this
  // call PATCHed a prior bot comment or POSTed a brand-new one — without it,
  // a caller can only ever say "posted", which is wrong once task 16's
  // update-in-place behavior actually updates something.
  return { ...comment, updated: Boolean(existing) };
}

module.exports = { postReviewComment, tokenFromEnv, GITHUB_API_URL, BOT_COMMENT_MARKER };
