const crypto = require('crypto');

const GITHUB_API_URL = 'https://api.github.com';

// Hidden marker prepended to every comment this tool posts, so a repeat run
// against the same PR (review-pr is explicitly designed for repeat
// invocation) can find and update its own prior comment instead of always
// creating a new one — see TASKS.md task 16 / RETRO.md for the observed
// growing-comment-thread problem this closes.
//
// The suffix is an HMAC of `owner/repo#prNumber` keyed by the caller's own
// GitHub token, not a fixed public string — a fixed marker lets any non-owning
// commenter on the PR post their own comment starting with the same text and
// have `findExistingBotComment` PATCH it instead of the real bot comment,
// permanently orphaning the genuine one. Deriving the suffix from the token
// makes it unpredictable to anyone without that credential, needs no extra
// API call (unlike checking the comment author against `GET /user`, which
// also breaks the default `GITHUB_TOKEN` in GitHub Actions), and works
// identically for `GITHUB_TOKEN` and PAT credentials alike. A token rotation
// between runs just misses the old comment and posts a new one — the same
// graceful "no prior comment found" fallback already used today.
// (TASKS.md task 19 / RETRO.md 2026-07-19 self-audit round 3.)
const BOT_COMMENT_PREFIX = '<!-- lead-agent-toolkit:review-pr';

function computeBotCommentMarker(token, owner, repo, prNumber) {
  const suffix = crypto.createHmac('sha256', token)
    .update(`${owner}/${repo}#${prNumber}`)
    .digest('hex')
    .slice(0, 16);
  return `${BOT_COMMENT_PREFIX}:${suffix} -->`;
}

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

// Finds this tool's own prior comment on the PR (identified by this PR's
// computed bot-comment marker), if any. Issue comments are returned
// oldest-first by GitHub, so pages are walked forward and the FIRST (oldest)
// match wins — not the most recent one.
//
// This matters because the marker, despite being HMAC-derived from the
// caller's token, is posted in plain text as the prefix of every comment
// this tool writes — it is not actually secret once posted, only unguessable
// *before* a first legitimate comment exists. A non-owning PR commenter can
// simply read a genuine bot comment's body, copy its marker verbatim, and
// post a new comment starting with that same marker. Under a
// last-match-wins search, that later, spoofed comment would be preferred
// over the genuine one, so all future runs would PATCH the attacker's
// comment forever, permanently orphaning the real one — the exact failure
// mode task 19 set out to prevent, which the original last-match-wins
// implementation did not actually close. Because the attacker can only copy
// a marker that has already been posted, the genuine comment is always the
// earliest marker-prefixed comment in the thread, so committing to the
// first match (and never overwriting it with a later one) closes the gap:
// a spoofed copy posted after the genuine comment is simply ignored.
// Returns null if no prior bot comment is found.
async function findExistingBotComment({ token, owner, repo, prNumber }, request) {
  const marker = computeBotCommentMarker(token, owner, repo, prNumber);
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

    const match = comments.find(
      (comment) => typeof comment.body === 'string' && comment.body.startsWith(marker),
    );
    if (match) return match;

    if (comments.length < COMMENTS_PER_PAGE) break;
  }
  return null;
}

// Posts `body` (markdown) as an issue comment on the given PR, or updates
// this tool's own prior comment on that PR in place if one already exists
// (identified by this PR's computed bot-comment marker), instead of always
// creating a new one. `deps.request` defaults to the global fetch (Node 20+)
// but is injectable so tests never hit the real GitHub API.
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

  const markedBody = `${computeBotCommentMarker(token, owner, repo, prNumber)}\n${body}`;
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

module.exports = {
  postReviewComment, tokenFromEnv, GITHUB_API_URL, BOT_COMMENT_PREFIX, computeBotCommentMarker,
};
