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
});
