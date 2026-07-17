const { collectAddedLines } = require('../utils/collectAddedLines');

const TEST_FILE_PATTERN = /(^|\/)tests\//;
const TEST_SUFFIX_PATTERN = /\.test\.js$/;
const SOURCE_DIR_PATTERN = /^(src|lib)\//;

function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path) || TEST_SUFFIX_PATTERN.test(path);
}

function check(files) {
  const sourceFiles = files.filter((f) => SOURCE_DIR_PATTERN.test(f.file) && !isTestFile(f.file));
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
