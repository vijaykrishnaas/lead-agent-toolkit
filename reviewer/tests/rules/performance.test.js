const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const performanceRule = require('../../src/rules/performance');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('performance rule', () => {
  it('flags await used inside a .forEach() callback', () => {
    const files = parseDiff(loadFixture('performance-await-in-foreach.diff'));
    const issues = performanceRule.check(files);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'src/services/notifyService.js',
      severity: 'medium',
    });
    expect(issues[0].message).toMatch(/forEach/);
  });

  it('flags the JSON.parse(JSON.stringify(...)) deep-clone anti-pattern', () => {
    const diff = [
      'diff --git a/src/utils/clone.js b/src/utils/clone.js',
      '--- a/src/utils/clone.js',
      '+++ b/src/utils/clone.js',
      '@@ -1,1 +1,2 @@',
      ' function clone(obj) {',
      '+  return JSON.parse(JSON.stringify(obj));',
    ].join('\n');

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('low');
  });

  it('returns no issues for a clean diff', () => {
    const files = parseDiff(loadFixture('clean.diff'));
    expect(performanceRule.check(files)).toEqual([]);
  });
});
