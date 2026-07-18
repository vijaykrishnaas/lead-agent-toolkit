const { execFileSync } = require('child_process');

const FIELD_SEP = '\x1f';

// Returns commits from `repo`'s git history since `since` (a Date or ISO date
// string), one record per commit: { hash, author, date, message }.
// `deps.execGit` is injectable so tests never shell out to real git.
function collectCommits({ repo = process.cwd(), since } = {}, deps = {}) {
  const execGit = deps.execGit || ((gitArgs, cwd) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }));

  if (!since) {
    throw new Error('Missing since — a Date or ISO date string is required.');
  }
  const sinceIso = since instanceof Date ? since.toISOString() : since;

  const output = execGit(['log', `--since=${sinceIso}`, `--pretty=format:%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`], repo);
  if (!output.trim()) return [];

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, ...subjectParts] = line.split(FIELD_SEP);
      return { hash, author, date, message: subjectParts.join(FIELD_SEP) };
    });
}

module.exports = { collectCommits };
