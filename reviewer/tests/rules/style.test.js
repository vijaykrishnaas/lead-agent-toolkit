const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const styleRule = require('../../src/rules/style');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('style rule', () => {
  it('flags "var" declarations and console.log calls', () => {
    const files = parseDiff(loadFixture('style-var-console.diff'));
    const issues = styleRule.check(files);

    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'low')).toBe(true);
    expect(issues.some((i) => /var/.test(i.message))).toBe(true);
    expect(issues.some((i) => /console\.log/.test(i.message))).toBe(true);
  });

  it('does not flag console.log inside test files', () => {
    const diff = [
      'diff --git a/tests/debug.test.js b/tests/debug.test.js',
      '--- a/tests/debug.test.js',
      '+++ b/tests/debug.test.js',
      '@@ -1,1 +1,2 @@',
      " test('x', () => {",
      '+  console.log("debugging");',
    ].join('\n');

    expect(styleRule.check(parseDiff(diff))).toEqual([]);
  });

  it('returns no issues for a clean diff', () => {
    const files = parseDiff(loadFixture('clean.diff'));
    expect(styleRule.check(files)).toEqual([]);
  });

  it('does not flag a string literal that merely mentions "console.log(" as leftover debug code', () => {
    // Regression: CONSOLE_LOG matched raw line content, so a log/error
    // message string quoted verbatim into an added line (no actual
    // console.log call executing) was reported as leftover debug code.
    const diff = [
      'diff --git a/src/help.js b/src/help.js',
      '--- a/src/help.js',
      '+++ b/src/help.js',
      '@@ -1,1 +1,2 @@',
      ' const x = 1;',
      '+const msg = "call console.log(x) to debug";',
    ].join('\n');

    expect(styleRule.check(parseDiff(diff))).toEqual([]);
  });

  it('does not flag a commented-out console.log call as leftover debug code', () => {
    // Companion to the string-literal case above: a `//`-commented-out call
    // doesn't execute, so it isn't "left in source" as real debug code
    // either -- consistent with this repo's established masking-before-
    // detection discipline (see CLAUDE.md's "detect whether a code
    // construct exists at all" guideline), which treats a comment the same
    // as a string for this purpose: neither is live code.
    const diff = [
      'diff --git a/src/help.js b/src/help.js',
      '--- a/src/help.js',
      '+++ b/src/help.js',
      '@@ -1,1 +1,2 @@',
      ' const x = 1;',
      '+  // console.log(debugVal);',
    ].join('\n');

    expect(styleRule.check(parseDiff(diff))).toEqual([]);
  });
});
