const { GITHUB_API_URL } = require('../github/postReviewComment');

const PER_PAGE = 50;
// Safety cap on pages fetched (1000 PRs) so a pathological `since` (or a
// GitHub API quirk) can't loop indefinitely — see the `hitOlder` early-exit
// below for the normal termination path.
const MAX_PAGES = 20;

// Lists pull requests for owner/repo, filtered to those updated since
// `since` (a Date or ISO date string). Results are requested newest-updated
// first, so pages are walked forward only until a PR older than `since` is
// seen (everything after it is also older) or a short page signals the last
// one — never a single fixed page, since a repo with more than 50 PRs
// updated inside the window would otherwise have older-but-in-window PRs
// silently dropped with no error or truncation signal.
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

  const inWindow = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      + `/pulls?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`;
    // eslint-disable-next-line no-await-in-loop
    const response = await request(url, { headers });

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const text = await response.text();
      throw new Error(`GitHub API request failed (${response.status}): ${text}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const pulls = await response.json();
    if (pulls.length === 0) break;

    let hitOlder = false;
    for (const pr of pulls) {
      if (new Date(pr.updated_at) >= sinceDate) {
        inWindow.push(pr);
      } else {
        hitOlder = true;
        break;
      }
    }

    if (hitOlder || pulls.length < PER_PAGE) break;
  }

  return inWindow.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: (pr.user && pr.user.login) || 'Unknown',
    state: pr.merged_at ? 'merged' : pr.state,
    updatedAt: pr.updated_at,
    url: pr.html_url,
  }));
}

module.exports = { collectPullRequests };
