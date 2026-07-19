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

  it('flags a source file even when a different source file with the same basename (in a different directory) has a matching test', () => {
    // Regression: matching was basename-only, so `src/utils/round.js` and
    // `src/other/round.js` in the same diff were treated as interchangeable
    // by a single `tests/round.test.js` -- even though that test file only
    // actually imports `src/utils/round`, leaving `src/other/round.js`
    // completely untested and unflagged.
    const files = parseDiff(loadFixture('missing-tests-basename-collision.diff'));
    const issues = missingTestsRule.check(files);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'src/other/round.js',
      severity: 'medium',
    });
    expect(issues.some((issue) => issue.file === 'src/utils/round.js')).toBe(false);
  });

  it('flags an untested source file even when a different source file in the same diff has a matching test', () => {
    const files = parseDiff(loadFixture('missing-tests-mixed-files.diff'));
    const issues = missingTestsRule.check(files);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'src/utils/round.js',
      severity: 'medium',
    });
    expect(issues.some((issue) => issue.file === 'src/utils/slugify.js')).toBe(false);
  });

  it('does not let a same-basename sibling\'s require of an unrelated, longer-named module satisfy the disambiguation check', () => {
    // Regression: testFileReferencesSource matched "utils/round" as a raw
    // substring, so a test file requiring a completely different module,
    // '../src/utils/roundRobin', silently satisfied the check for
    // src/utils/round.js purely because "utils/round" is a substring of
    // "utils/roundRobin" -- leaving that sibling untested and unflagged
    // even though the test file never actually references it.
    const diff = [
      'diff --git a/src/utils/round.js b/src/utils/round.js',
      '--- a/src/utils/round.js',
      '+++ b/src/utils/round.js',
      '@@ -1,1 +1,2 @@',
      ' function round(value, digits) {}',
      '+exports.round = round;',
      'diff --git a/src/other/round.js b/src/other/round.js',
      '--- a/src/other/round.js',
      '+++ b/src/other/round.js',
      '@@ -1,1 +1,2 @@',
      ' function round(value, mode) {}',
      '+exports.round = round;',
      'diff --git a/tests/round.test.js b/tests/round.test.js',
      '--- a/tests/round.test.js',
      '+++ b/tests/round.test.js',
      '@@ -1,1 +1,2 @@',
      " const { roundRobin } = require('../src/utils/roundRobin');",
      "+test('rounds', () => { expect(roundRobin()).toBe(1); });",
    ].join('\n');

    const issues = missingTestsRule.check(parseDiff(diff));

    expect(issues.map((issue) => issue.file).sort()).toEqual(['src/other/round.js', 'src/utils/round.js']);
  });
});
