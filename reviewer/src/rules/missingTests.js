const { collectAddedLines } = require('../utils/collectAddedLines');

const TEST_FILE_PATTERN = /(^|\/)tests\//;
const TEST_SUFFIX_PATTERN = /\.test\.js$/;
const DEFAULT_SOURCE_DIRS = ['src', 'lib'];

function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path) || TEST_SUFFIX_PATTERN.test(path);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSourceDirPattern(sourceDirs) {
  return new RegExp(`^(${sourceDirs.map(escapeRegExp).join('|')})/`);
}

function baseName(filePath) {
  const segments = filePath.split('/');
  return segments[segments.length - 1];
}

// True if `testFile` plausibly imports/requires this specific source file --
// checked by looking for its parent-directory segment alongside its
// basename (e.g. "utils/round"), not just the bare basename, so a test
// importing a same-named file from a *different* directory doesn't count as
// a reference. Looks at every line in the test file's hunks (both added and
// unchanged context), since the require/import statement is often
// pre-existing context rather than a line newly added by this diff.
// Matched as a whole path segment, not a raw substring — "utils/round" is a
// substring of "utils/roundRobin", so a require of a completely different,
// unrelated module would otherwise satisfy the check for "round" too.
function testFileReferencesSource(testFile, sourceFile) {
  const segments = sourceFile.file.replace(/\.js$/, '').split('/');
  const qualified = segments.slice(-2).join('/'); // e.g. "utils/round"
  const content = testFile.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.type === 'add' || line.type === 'context')
    .map((line) => line.content)
    .join('\n');
  const boundaryPattern = new RegExp(`(^|[^\\w])${escapeRegExp(qualified)}($|[^\\w])`);
  return boundaryPattern.test(content);
}

// Matches a source file to a changed test file by basename convention (e.g.
// `round.js` <-> `round.test.js`), not merely "some test file changed
// anywhere in this diff" -- see check() below for why that distinction
// matters. `siblings` is every other source file in this diff sharing the
// same basename: when there's more than one (e.g. `src/utils/round.js` and
// `src/other/round.js` in the same diff), basename alone can't tell which
// one a single `round.test.js` actually covers, so in that case a matching
// test file must also reference this file's own parent directory in its
// import -- otherwise a test for one sibling would silently satisfy the
// check for an entirely different, untested file that just shares a name.
function hasMatchingTestFile(sourceFile, testFiles, siblings) {
  const sourceBase = baseName(sourceFile.file).replace(/\.js$/, '');
  const candidates = testFiles.filter((testFile) => {
    const testBase = baseName(testFile.file).replace(/\.test\.js$/, '').replace(/\.js$/, '');
    return testBase === sourceBase;
  });
  if (candidates.length === 0) return false;
  if (siblings.length <= 1) return true;
  return candidates.some((testFile) => testFileReferencesSource(testFile, sourceFile));
}

// `options.sourceDirs` lets config (review-rules.yaml, via the rule loader)
// widen which directories count as "source" beyond the bare src/lib default
// -- e.g. nested packages like sample-app/src, or a client/src + server/src
// MERN split -- without hardcoding every repo layout into the rule itself.
function check(files, options = {}) {
  const sourceDirs = Array.isArray(options.sourceDirs) && options.sourceDirs.length > 0
    ? options.sourceDirs
    : DEFAULT_SOURCE_DIRS;
  const sourceDirPattern = buildSourceDirPattern(sourceDirs);

  const sourceFiles = files.filter((f) => sourceDirPattern.test(f.file) && !isTestFile(f.file));
  const testFiles = files.filter((f) => isTestFile(f.file));

  if (sourceFiles.length === 0) return [];

  const sourceFilesByBase = new Map();
  for (const file of sourceFiles) {
    const base = baseName(file.file).replace(/\.js$/, '');
    if (!sourceFilesByBase.has(base)) sourceFilesByBase.set(base, []);
    sourceFilesByBase.get(base).push(file);
  }

  // Scoped per source file: whether *this* file has a plausibly-matching
  // test file changed in the same diff, not whether *any* test file changed
  // anywhere in the diff. The latter let a test file for one source file
  // silence the finding for a completely unrelated, untested source file
  // changed in the same commit -- including two different source files that
  // happen to share a basename in different directories (see
  // hasMatchingTestFile's `siblings` handling).
  return sourceFiles
    .filter((file) => {
      const siblings = sourceFilesByBase.get(baseName(file.file).replace(/\.js$/, ''));
      return !hasMatchingTestFile(file, testFiles, siblings);
    })
    .map((file) => {
      const firstAdd = collectAddedLines(file)[0];
      return {
        file: file.file,
        line: firstAdd ? firstAdd.newLine : 1,
        severity: 'medium',
        message: `Source file "${file.file}" changed but no test file changed in this diff.`,
        fix: 'Add or update a corresponding test under tests/ covering the new or changed behavior, including a rejected-promise case for async handlers.',
      };
    });
}

module.exports = { category: 'missing-tests', check };
