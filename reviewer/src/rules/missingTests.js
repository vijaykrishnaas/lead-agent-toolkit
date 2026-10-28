const { collectAddedLines } = require('../utils/collectAddedLines');
const { isTestFile } = require('../utils/isTestFile');
const { isCodeFile } = require('../utils/isCodeFile');
const { maskComments, maskStringLiterals } = require('../utils/maskStringLiterals');

// Only code files can need a test; a changed .css/.json/.md under src/ is not
// a testable source file.
// Same extension set as utils/isCodeFile (incl. .mts/.cts); used to strip the extension.
const CODE_FILE_PATTERN = /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i;
const DEFAULT_SOURCE_DIRS = ['src', 'lib'];

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

// Basename with the code extension and any .test/.spec marker removed, so
// `a.ts`, `a.test.ts` and `a.spec.js` all reduce to `a`.
function stemName(filePath) {
  return baseName(filePath).replace(CODE_FILE_PATTERN, '').replace(/\.(test|spec)$/, '');
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
  const segments = sourceFile.file.replace(CODE_FILE_PATTERN, '').split('/');
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
function matchingTestFiles(sourceFile, testFiles, siblings) {
  const sourceBase = stemName(sourceFile.file);
  const candidates = testFiles.filter((testFile) => stemName(testFile.file) === sourceBase);
  if (siblings.length <= 1) return candidates;
  return candidates.filter((testFile) => testFileReferencesSource(testFile, sourceFile));
}

const ASYNC_PATTERN = /\basync\b/;
const REJECTION_PATTERN = /reject|toThrow|throw\b|\.catch\(/i;

function addedText(file) {
  return collectAddedLines(file).map((line) => line.content).join('\n');
}

// Source adds async code (comments and string literals masked, so "async" in
// a comment or a string doesn't count) but none of its matching test diffs add a rejection-path case
// (test comments masked too, so a "// TODO reject case" note does not count).
function lacksRejectionCase(sourceFile, matchedTests) {
  if (!ASYNC_PATTERN.test(maskStringLiterals(addedText(sourceFile)).masked)) return false;
  return !matchedTests.some((testFile) => REJECTION_PATTERN.test(maskComments(addedText(testFile)).masked));
}

// `options.sourceDirs` lets config (review-rules.yaml, via the rule loader)
// widen which directories count as "source" beyond the bare src/lib default
// -- e.g. nested packages like sample-app/src, or a client/src + server/src
// MERN split -- without hardcoding every repo layout into the rule itself.
function check(files, options = {}) {
  // Config is user-edited YAML: drop non-string/empty entries and trailing
  // slashes ("app/" would otherwise build the never-matching "app//").
  const configured = Array.isArray(options.sourceDirs)
    ? options.sourceDirs
      .filter((dir) => typeof dir === 'string')
      .map((dir) => dir.replace(/\/+$/, ''))
      .filter((dir) => dir.length > 0)
    : [];
  const sourceDirs = configured.length > 0 ? configured : DEFAULT_SOURCE_DIRS;
  const sourceDirPattern = buildSourceDirPattern(sourceDirs);

  const sourceFiles = files.filter((f) => sourceDirPattern.test(f.file) && isCodeFile(f.file) && !isTestFile(f.file) && !f.deleted);
  const testFiles = files.filter((f) => isTestFile(f.file) && !f.deleted);

  if (sourceFiles.length === 0) return [];

  const sourceFilesByBase = new Map();
  for (const file of sourceFiles) {
    const base = stemName(file.file);
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
  const issues = [];
  for (const file of sourceFiles) {
    const siblings = sourceFilesByBase.get(stemName(file.file));
    const matched = matchingTestFiles(file, testFiles, siblings);
    const firstAdd = collectAddedLines(file)[0];
    const line = firstAdd ? firstAdd.newLine : 1;
    if (matched.length === 0) {
      issues.push({
        file: file.file,
        line,
        severity: 'medium',
        message: `Source file "${file.file}" changed but no test file changed in this diff.`,
        fix: 'Add or update a corresponding test under tests/ covering the new or changed behavior, including a rejected-promise case for async handlers.',
      });
    } else if (lacksRejectionCase(file, matched)) {
      issues.push({
        file: file.file,
        line,
        severity: 'low',
        message: `Source file "${file.file}" adds async code but its changed test file(s) add no rejected-promise case.`,
        fix: 'Add a test where the awaited collaborator rejects and assert the error is handled.',
      });
    }
  }
  return issues;
}

module.exports = { category: 'missing-tests', check };
