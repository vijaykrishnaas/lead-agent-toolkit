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

  if (sourceFiles.length === 0 || testFiles.length > 0) return [];

  return sourceFiles.map((file) => {
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
