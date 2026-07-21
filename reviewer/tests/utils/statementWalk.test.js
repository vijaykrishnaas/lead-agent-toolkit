const { walkStatement } = require('../../src/utils/statementWalk');

function linesFrom(contents) {
  return contents.map((content, i) => ({ content, newLine: i + 1 }));
}

function joinedContent(result) {
  return result.lines.map((l) => l.content).join('\n');
}

describe('walkStatement', () => {
  it('collects a single-line, semicolon-terminated statement', () => {
    const addedLines = linesFrom(['const x = 1;', 'const y = 2;']);
    const result = walkStatement(addedLines, 0);
    expect(joinedContent(result)).toBe('const x = 1;');
  });

  it('collects a multi-line .then() chain up through its own .catch()', () => {
    const addedLines = linesFrom([
      'promise',
      '  .then((x) => doSomething(x))',
      '  .catch((err) => log(err));',
      'const unrelated = 2;',
    ]);
    const result = walkStatement(addedLines, 0);
    expect(joinedContent(result)).toBe(
      ['promise', '  .then((x) => doSomething(x))', '  .catch((err) => log(err));'].join('\n')
    );
  });

  it('stops at an unrelated following statement instead of sweeping it in (no trailing semicolon)', () => {
    const addedLines = linesFrom([
      'exports.getWidget = async (req, res) => res.json(req.params.id)',
      'exports.putWidget = async (req, res) => {',
    ]);
    const result = walkStatement(addedLines, 0);
    expect(joinedContent(result)).toBe('exports.getWidget = async (req, res) => res.json(req.params.id)');
  });

  it('treats a blank or comment-only line as a non-terminating continuation', () => {
    const addedLines = linesFrom([
      'promise',
      '  .then((x) => doSomething(x))',
      '  // still chaining below',
      '',
      '  .catch((err) => log(err));',
    ]);
    const result = walkStatement(addedLines, 0);
    expect(joinedContent(result)).toBe(addedLines.map((l) => l.content).join('\n'));
  });

  it('masks parens inside string literals so they do not skew depth tracking', () => {
    const addedLines = linesFrom(['doThing("looks like a ) paren");', 'const unrelated = 2;']);
    const result = walkStatement(addedLines, 0);
    expect(joinedContent(result)).toBe('doThing("looks like a ) paren");');
  });

  it('finds a same-line brace via onChar once paren depth returns to 0', () => {
    const addedLines = linesFrom(['exports.getWidget = async (req, res) => {', '  ok();', '};']);
    let found = null;
    const result = walkStatement(addedLines, 0, {
      onChar: (ch, depth, lineIndex, column) => {
        if (ch === '{' && depth <= 0) {
          found = { lineIndex, column };
          return found;
        }
        return null;
      },
    });
    expect(result.found).toEqual(found);
    expect(addedLines[found.lineIndex].content[found.column]).toBe('{');
  });

  it('does not mistake a default-parameter object literal brace (still inside the paren list) for the target', () => {
    const addedLines = linesFrom(['async (req, res, opts = {}) => {', '  ok();', '}']);
    const hits = [];
    walkStatement(addedLines, 0, {
      onChar: (ch, depth, lineIndex, column) => {
        if (ch === '{') hits.push({ depth, lineIndex, column });
        return null;
      },
    });
    // Two '{' characters: the default-param one (depth 1, still inside the
    // signature's own paren list) and the real body one (depth 0).
    expect(hits).toHaveLength(2);
    expect(hits[0].depth).toBe(1);
    expect(hits[1].depth).toBe(0);
  });

  it('starts the walk at startColumn on the first line only', () => {
    const addedLines = linesFrom(['exports.getWidget = async (req, res) => {']);
    const startColumn = addedLines[0].content.indexOf('async');
    const result = walkStatement(addedLines, 0, { startColumn });
    expect(result.lines[0].content).toBe(addedLines[0].content.slice(startColumn));
  });

  it('without exemptLeadingBrace, treats a lone "{" line as the statement already having ended', () => {
    const addedLines = linesFrom(['async (req, res) =>', '// a comment', '{', '  ok();', '}']);
    let sawBrace = false;
    walkStatement(addedLines, 0, {
      onChar: (ch) => {
        if (ch === '{') sawBrace = true;
        return null;
      },
    });
    expect(sawBrace).toBe(false);
  });

  it('with exemptLeadingBrace, still scans a lone "{" line reached after a comment', () => {
    const addedLines = linesFrom(['async (req, res) =>', '// a comment', '{', '  ok();', '}']);
    let found = null;
    walkStatement(addedLines, 0, {
      exemptLeadingBrace: true,
      onChar: (ch, depth, lineIndex, column) => {
        if (ch === '{' && depth <= 0) {
          found = { lineIndex, column };
          return found;
        }
        return null;
      },
    });
    expect(found).toEqual({ lineIndex: 2, column: 0 });
  });

  it('returns found: null when the walk runs out of lines with no match', () => {
    const addedLines = linesFrom(['const x =', '  1;']);
    const result = walkStatement(addedLines, 0, { onChar: () => null });
    expect(result.found).toBeNull();
  });

  it('stops immediately once onChar returns a truthy value, without scanning further characters', () => {
    const addedLines = linesFrom(['a(b(c(d)))']);
    const seen = [];
    const result = walkStatement(addedLines, 0, {
      onChar: (ch) => {
        seen.push(ch);
        return ch === 'c' ? 'stopped-here' : null;
      },
    });
    expect(result.found).toBe('stopped-here');
    expect(seen).toEqual(['a', '(', 'b', '(', 'c']);
  });
});
