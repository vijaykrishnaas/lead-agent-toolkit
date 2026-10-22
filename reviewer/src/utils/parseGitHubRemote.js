// Parses a git remote URL into { owner, repo } for github.com remotes, or
// returns null for anything else (other hosts, local paths, malformed input).
// Handles https://, ssh://, and scp-style git@github.com:owner/repo(.git).
const REMOTE_PATTERN = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com(?::\d+\/|[/:])([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

function parseGitHubRemote(url) {
  if (typeof url !== 'string') return null;
  const match = REMOTE_PATTERN.exec(url.trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

module.exports = { parseGitHubRemote };
