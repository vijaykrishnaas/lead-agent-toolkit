// Resolves a file's post-image content via `git show <sha>:<path>`. Returns
// null (never throws) when the file can't be resolved this way -- deleted
// in the diff, outside the given repo, sha unavailable, etc. -- so callers
// can treat "unresolvable" as a normal case and fall back to the diff-only
// text/regex path (see CLAUDE.md AUDIT.md F3).
function resolveFileContent({ execGit, repo, sha, path }) {
  try {
    return execGit(['show', `${sha}:${path}`], repo);
  } catch (err) {
    return null;
  }
}

module.exports = { resolveFileContent };
