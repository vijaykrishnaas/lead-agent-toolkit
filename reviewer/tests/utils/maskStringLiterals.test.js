const { maskStringLiterals } = require('../../src/utils/maskStringLiterals');

describe('maskStringLiterals', () => {
  it('masks a double-quoted string, preserving length and non-string characters', () => {
    const content = 'res.json({ note: "unexpected {" });';
    const { masked, quoteState } = maskStringLiterals(content);
    expect(masked).toBe('res.json({ note:                });');
    expect(masked.length).toBe(content.length);
    expect(quoteState).toBeNull();
  });

  it('masks single- and backtick-quoted strings the same way', () => {
    expect(maskStringLiterals("log('a } b')").masked).toBe('log(       )');
    expect(maskStringLiterals('log(`a } b`)').masked).toBe('log(       )');
  });

  it('does not end the string early on an escaped quote', () => {
    const { masked, quoteState } = maskStringLiterals('log("a \\" b } c")');
    expect(masked).toBe('log(            )');
    expect(quoteState).toBeNull();
  });

  it('threads quoteState across lines for a multi-line template literal', () => {
    const first = maskStringLiterals('const x = `line one {', null);
    expect(first.quoteState).toBe('`');
    const second = maskStringLiterals('line two } still inside`;', first.quoteState);
    expect(second.masked).toBe('                        ;');
    expect(second.quoteState).toBeNull();
  });

  it('preserves length when a chunk ends with a lone backslash mid-escape inside an open string', () => {
    // Regression: a trailing backslash as the very last character of a
    // chunk (e.g. one line of a multi-line template literal ending in a
    // line-continuation escape) has no next character in *this* chunk to
    // pair with. The old code always consumed 2 characters for an escape
    // (`i += 2`), stepping past content.length and appending 2 spaces for
    // only 1 real character -- violating the documented same-length
    // invariant by 1 character, even though quoteState still threaded
    // through correctly.
    const content = '  line ends with backslash \\';
    const { masked, quoteState } = maskStringLiterals(content, '`');
    expect(masked.length).toBe(content.length);
    expect(quoteState).toBe('`');
  });

  it('leaves code outside strings untouched', () => {
    const { masked } = maskStringLiterals('if (x) { return { a: 1 }; }');
    expect(masked).toBe('if (x) { return { a: 1 }; }');
  });
});
