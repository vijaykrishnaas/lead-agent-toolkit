const { isTestFile } = require('../../src/utils/isTestFile');

describe('isTestFile', () => {
  it('recognizes tests/, test/ and __tests__/ directories at any depth', () => {
    for (const p of ['tests/a.js', 'test/a.js', '__tests__/a.js', 'src/__tests__/a.js', 'pkg/test/a.js']) {
      expect(isTestFile(p)).toBe(true);
    }
  });

  it('recognizes .test/.spec files of every code extension', () => {
    for (const p of ['src/a.test.js', 'src/a.spec.ts', 'src/a.test.mjs', 'src/a.spec.tsx']) {
      expect(isTestFile(p)).toBe(true);
    }
  });

  it('does not match lookalike directory or file names', () => {
    for (const p of ['src/latest/a.js', 'src/contest/a.js', 'src/mytests/a.js', 'src/a.js', 'src/test.js']) {
      expect(isTestFile(p)).toBe(false);
    }
  });
});
