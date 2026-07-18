const { collectCommits } = require('./collectCommits');
const { collectPullRequests } = require('./collectPullRequests');
const { groupByAuthor } = require('./groupByAuthor');
const { formatStandupReport } = require('./formatStandup');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Generates a per-author standup markdown report covering the last 24h (or
// since `options.since`) of git commits in `options.repo`, plus GitHub pull
// request activity when `options.owner`/`options.ghRepo` are both given.
// All collection is dependency-injected (see collectCommits /
// collectPullRequests) so tests never shell out to git or hit the real
// GitHub API.
async function generateStandup(options = {}, deps = {}) {
  const { repo = process.cwd(), owner, ghRepo } = options;
  const since = options.since instanceof Date ? options.since : new Date(options.since || Date.now() - ONE_DAY_MS);

  const collectCommitsFn = deps.collectCommits || collectCommits;
  const collectPullRequestsFn = deps.collectPullRequests || collectPullRequests;

  const commits = await collectCommitsFn({ repo, since }, deps);
  const pullRequests = owner && ghRepo ? await collectPullRequestsFn({ owner, repo: ghRepo, since }, deps) : [];

  const groups = groupByAuthor({ commits, pullRequests });
  return formatStandupReport(groups, { since: since.toISOString() });
}

module.exports = { generateStandup };
