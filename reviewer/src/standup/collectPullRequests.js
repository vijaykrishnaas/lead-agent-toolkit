const { GITHUB_API_URL } = require('../github/postReviewComment');

// Lists pull requests for owner/repo, filtered to those updated since
// `since` (a Date or ISO date string). Fetches one page (50, most-recently
// updated first) — enough for a "last 24h" report; a repo with more than 50
// PRs updated inside the window would need pagination this doesn't do.
// `deps.request` defaults to the global fetch (Node 20+) but is injectable so
// tests never hit the real GitHub API. `deps.token` is optional —
// unauthenticated requests work but are more tightly rate-limited by GitHub.
async function collectPullRequests({ owner, repo, since } = {}, deps = {}) {
  const request = deps.request || fetch;

  if (!owner || !repo) {
    throw new Error('Missing owner/repo — both are required to list pull requests.');
  }
  if (!since) {
    throw new Error('Missing since — a Date or ISO date string is required.');
  }

  const sinceDate = since instanceof Date ? since : new Date(since);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'lead-agent-toolkit-reviewer' };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`;
  const response = await request(url, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }

  const pulls = await response.json();
  return pulls
    .filter((pr) => new Date(pr.updated_at) >= sinceDate)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: (pr.user && pr.user.login) || 'Unknown',
      state: pr.merged_at ? 'merged' : pr.state,
      updatedAt: pr.updated_at,
      url: pr.html_url,
    }));
}

module.exports = { collectPullRequests };
