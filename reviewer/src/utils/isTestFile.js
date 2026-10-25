// Shared by missingTests and style: a path is a test file when it sits under a
// tests/, test/ or __tests__/ directory (any depth, whole segment) or carries a
// .test/.spec marker. Jest and mocha layouts both use these conventions.
const TEST_DIR_PATTERN = /(^|\/)(?:tests?|__tests__)\//;
const TEST_SUFFIX_PATTERN = /\.(?:test|spec)\.[mc]?[jt]sx?$/;

function isTestFile(path) {
  return TEST_DIR_PATTERN.test(path) || TEST_SUFFIX_PATTERN.test(path);
}

module.exports = { isTestFile };
