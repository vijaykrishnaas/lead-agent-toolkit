const { collectBoundedBlock } = require('../../src/utils/collectBoundedBlock');

function linesFrom(contents) {
  return contents.map((content, i) => ({ content, newLine: i + 1 }));
}

describe('collectBoundedBlock', () => {
  it('collects a single-line block from its own opening to closing brace', () => {
    const addedLines = linesFrom(['function f() { return 1; }']);
    expect(collectBoundedBlock(addedLines, 0)).toBe('function f() { return 1; }');
  });

  it('collects a multi-line block up to its matching closing brace', () => {
    const addedLines = linesFrom([
      'function f() {',
      '  doSomething();',
      '  return 1;',
      '}',
      'const unrelated = 2;',
    ]);
    expect(collectBoundedBlock(addedLines, 0)).toBe(
      ['function f() {', '  doSomething();', '  return 1;', '}'].join('\n')
    );
  });

  it('tracks nested brace depth so an inner block does not end the outer one early', () => {
    const addedLines = linesFrom([
      'function f() {',
      '  if (x) {',
      '    doInner();',
      '  }',
      '  return 1;',
      '}',
      'const unrelated = 2;',
    ]);
    const block = collectBoundedBlock(addedLines, 0);
    expect(block).toContain('doInner');
    expect(block).toContain('return 1');
    expect(block).not.toContain('unrelated');
  });

  it('bounds the block by its own braces, not by where a second occurrence starts', () => {
    const addedLines = linesFrom([
      'function first() {',
      '  ok();',
      '}',
      'function unrelatedHelper() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    log(e);',
      '  }',
      '}',
      'function second() {',
      '  ok();',
      '}',
    ]);

    const firstBlock = collectBoundedBlock(addedLines, 0);
    expect(firstBlock).toBe(['function first() {', '  ok();', '}'].join('\n'));
    expect(firstBlock).not.toContain('try');
    expect(firstBlock).not.toContain('unrelatedHelper');

    const secondBlock = collectBoundedBlock(addedLines, 10);
    expect(secondBlock).toBe(['function second() {', '  ok();', '}'].join('\n'));
    expect(secondBlock).not.toContain('try');
  });

  it('reads to the end of the input if no matching closing brace is ever found', () => {
    const addedLines = linesFrom(['function f() {', '  doSomething();']);
    expect(collectBoundedBlock(addedLines, 0)).toBe(
      ['function f() {', '  doSomething();'].join('\n')
    );
  });

  it('reads to the end of the input when the start line has no opening brace at all', () => {
    const addedLines = linesFrom(['const x = 1;', 'const y = 2;']);
    expect(collectBoundedBlock(addedLines, 0)).toBe(['const x = 1;', 'const y = 2;'].join('\n'));
  });

  it('does not let a brace character inside a string literal over-extend the block', () => {
    const addedLines = linesFrom([
      'exports.getWidget = async (req, res) => {',
      '  res.json({ note: "unexpected {" });',
      '};',
      'function unrelatedHelper() {',
      '  try { doSomething(); } catch (e) { log(e); }',
      '}',
    ]);

    const block = collectBoundedBlock(addedLines, 0);
    expect(block).toBe([
      'exports.getWidget = async (req, res) => {',
      '  res.json({ note: "unexpected {" });',
      '};',
    ].join('\n'));
    expect(block).not.toContain('try');
    expect(block).not.toContain('unrelatedHelper');
  });

  it('does not let a brace character inside a string literal truncate the block early', () => {
    const addedLines = linesFrom([
      'exports.getWidget = async (req, res) => {',
      '  console.log("weird } char");',
      '  try { doX(); } catch (err) { log(err); }',
      '};',
    ]);

    const block = collectBoundedBlock(addedLines, 0);
    expect(block).toContain('try { doX(); } catch (err) { log(err); }');
    expect(block).toContain('};');
  });
});
