const { parseDiff } = require('../src/diffParser');

const SIMPLE_DIFF = [
  'diff --git a/src/foo.js b/src/foo.js',
  'index e69de29..4b825dc 100644',
  '--- a/src/foo.js',
  '+++ b/src/foo.js',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const b = 2;',
  '-const old = 0;',
  ' module.exports = a;',
].join('\n');

describe('parseDiff', () => {
  it('extracts the file path from the +++ header', () => {
    const files = parseDiff(SIMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe('src/foo.js');
  });

  it('assigns correct new-line numbers to added and context lines', () => {
    const [file] = parseDiff(SIMPLE_DIFF);
    const [hunk] = file.hunks;
    const added = hunk.lines.find((l) => l.type === 'add');
    const context = hunk.lines.filter((l) => l.type === 'context');

    expect(added.content).toBe('const b = 2;');
    expect(added.newLine).toBe(2);

    expect(context[0].newLine).toBe(1);
    expect(context[1].newLine).toBe(3);
  });

  it('assigns correct old-line numbers to deleted lines and leaves newLine null', () => {
    const [file] = parseDiff(SIMPLE_DIFF);
    const [hunk] = file.hunks;
    const deleted = hunk.lines.find((l) => l.type === 'del');

    expect(deleted.content).toBe('const old = 0;');
    expect(deleted.oldLine).toBe(2);
    expect(deleted.newLine).toBeNull();
  });

  it('returns an empty array for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('parses multiple files in a single diff', () => {
    const twoFileDiff = [
      SIMPLE_DIFF,
      'diff --git a/src/bar.js b/src/bar.js',
      'index e69de29..4b825dc 100644',
      '--- a/src/bar.js',
      '+++ b/src/bar.js',
      '@@ -1,1 +1,2 @@',
      ' const x = 1;',
      '+const y = 2;',
    ].join('\n');

    const files = parseDiff(twoFileDiff);
    expect(files.map((f) => f.file)).toEqual(['src/foo.js', 'src/bar.js']);
  });
});
