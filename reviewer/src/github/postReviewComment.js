const GITHUB_API_URL = 'https://api.github.com';

// Reads the token from the environment so callers never have to hardcode or
// pass secrets around explicitly; injectable `env` keeps this testable.
function tokenFromEnv(env = process.env) {
  return env.GITHUB_TOKEN || null;
}

// Posts `body` (markdown) as an issue comment on the given PR. `deps.request`
// defaults to the global fetch (Node 20+) but is injectable so tests never
// hit the real GitHub API.
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

  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const response = await request(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'lead-agent-toolkit-reviewer',
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }

  return response.json();
}

module.exports = { postReviewComment, tokenFromEnv, GITHUB_API_URL };
