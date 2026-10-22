const { parseDiff } = require('../../src/diffParser');
const { isCodeFile } = require('../../src/utils/isCodeFile');
const errorHandling = require('../../src/rules/errorHandling');
const performance = require('../../src/rules/performance');
const style = require('../../src/rules/style');

function diffFor(file, line) {
  return parseDiff(
    [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      '@@ -1,1 +1,2 @@',
      ' x',
      `+${line}`,
    ].join('\n')
  );
}

describe('code-file gating', () => {
  it('isCodeFile accepts JS/TS extensions only', () => {
    for (const p of ['a.js', 'a/b.mjs', 'c.cjs', 'd.ts', 'e.tsx', 'f.jsx', 'g.mts', 'h.cts']) expect(isCodeFile(p)).toBe(true);
    for (const p of ['PROGRESS.md', 'a.yaml', 'b.json', 'js', undefined]) expect(isCodeFile(p)).toBe(false);
  });

  const cases = [
    ['errorHandling', errorHandling, 'fetchIt().then(r => r);'],
    ['performance', performance, 'items.forEach(async (i) => { await save(i); });'],
    ['style', style, 'console.log("x");'],
  ];
  for (const [name, rule, line] of cases) {
    it(`${name}: markdown line is ignored, same line in .js still flagged`, () => {
      expect(rule.check(diffFor('PROGRESS.md', line))).toHaveLength(0);
      expect(rule.check(diffFor('src/a.js', line)).length).toBeGreaterThan(0);
    });
  }
});
