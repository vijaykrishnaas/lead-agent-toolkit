const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const missingTestsRule = require('../../src/rules/missingTests');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('missing-tests rule', () => {
  it('flags a source file changed with no corresponding test file changed', () => {
    const files = parseDiff(loadFixture('missing-tests.diff'));
    const issues = missingTestsRule.check(files);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'src/utils/round.js',
      severity: 'medium',
    });
  });

  it('does not flag when a test file is included in the diff', () => {
    const files = parseDiff(loadFixture('clean.diff'));
    expect(missingTestsRule.check(files)).toEqual([]);
  });

  it('does not flag a diff that touches only test files', () => {
    const diff = [
      'diff --git a/tests/round.test.js b/tests/round.test.js',
      '--- a/tests/round.test.js',
      '+++ b/tests/round.test.js',
      '@@ -1,1 +1,2 @@',
      " const { round } = require('../src/utils/round');",
      "+test('rounds', () => { expect(round(1.005, 2)).toBeCloseTo(1.01); });",
    ].join('\n');

    expect(missingTestsRule.check(parseDiff(diff))).toEqual([]);
  });

  it('uses the default src/lib pattern when no sourceDirs option is given', () => {
    const diff = [
      'diff --git a/sample-app/src/controllers/widgetsController.js b/sample-app/src/controllers/widgetsController.js',
      '--- a/sample-app/src/controllers/widgetsController.js',
      '+++ b/sample-app/src/controllers/widgetsController.js',
      '@@ -1,1 +1,2 @@',
      ' module.exports = {};',
      '+exports.noop = () => {};',
    ].join('\n');

    expect(missingTestsRule.check(parseDiff(diff))).toEqual([]);
  });

  it('flags a nested package source file when sourceDirs is widened via options', () => {
    const diff = [
      'diff --git a/sample-app/src/controllers/widgetsController.js b/sample-app/src/controllers/widgetsController.js',
      '--- a/sample-app/src/controllers/widgetsController.js',
      '+++ b/sample-app/src/controllers/widgetsController.js',
      '@@ -1,1 +1,2 @@',
      ' module.exports = {};',
      '+exports.noop = () => {};',
    ].join('\n');

    const issues = missingTestsRule.check(parseDiff(diff), { sourceDirs: ['sample-app/src'] });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'sample-app/src/controllers/widgetsController.js', severity: 'medium' });
  });

  it('falls back to the default sourceDirs when options.sourceDirs is empty', () => {
    const files = parseDiff(loadFixture('missing-tests.diff'));
    expect(missingTestsRule.check(files, { sourceDirs: [] })).toEqual(missingTestsRule.check(files));
  });
});
