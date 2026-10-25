const { execFileSync } = require('child_process');

// execFileSync's default maxBuffer is 1 MiB; a large `git diff`/`git log`
// (the exact case a reviewer exists for) exceeds it and throws ENOBUFS, so the
// whole run fails. Every default execGit goes through this one factory.
const MAX_BUFFER = 256 * 1024 * 1024;

function defaultExecGit(binary = 'git') {
  return (gitArgs, cwd) => execFileSync(binary, gitArgs, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

module.exports = { defaultExecGit, MAX_BUFFER };
