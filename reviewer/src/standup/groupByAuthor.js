// Groups commits and pull requests by author into
// Map<author, { commits: [...], pullRequests: [...] }>, preserving each
// list's input order. Missing/blank authors are bucketed under "Unknown"
// rather than dropped.
function groupByAuthor({ commits = [], pullRequests = [] } = {}) {
  const groups = new Map();

  const bucket = (author) => {
    const key = author || 'Unknown';
    if (!groups.has(key)) groups.set(key, { commits: [], pullRequests: [] });
    return groups.get(key);
  };

  for (const commit of commits) bucket(commit.author).commits.push(commit);
  for (const pr of pullRequests) bucket(pr.author).pullRequests.push(pr);

  return groups;
}

module.exports = { groupByAuthor };
