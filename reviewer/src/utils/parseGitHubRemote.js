// Parses a git remote URL into { owner, repo } for github.com remotes, or
// returns null for anything else (other hosts, local paths, malformed input).
// Handles https://, ssh://, and scp-style git@github.com:owner/repo(.git).
const REMOTE_PATTERN = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com(?::\d+\/|[/:])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

function parseGitHubRemote(url) {
  if (typeof url !== 'string') return null;
  const match = REMOTE_PATTERN.exec(url.trim());
  if (!match || /^\.+$/.test(match[1]) || /^\.+$|^\.git$/.test(match[2])) return null;
  return { owner: match[1], repo: match[2] };
}

module.exports = { parseGitHubRemote };
