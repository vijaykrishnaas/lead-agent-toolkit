const { maskStringLiterals, maskComments } = require('../../src/utils/maskStringLiterals');

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

  it('masks a trailing // line comment, including any braces/parens it contains', () => {
    // Regression: a same-line trailing comment documenting a shape (e.g.
    // "returns {id, name}") was previously left unmasked, so a caller
    // counting braces (collectBoundedBlock) mistook the comment's own
    // balanced '{'/'}' for real code structure.
    const content = 'async (req, res) => // returns {id, name}';
    const { masked, quoteState } = maskStringLiterals(content);
    expect(masked).toBe('async (req, res) =>                      ');
    expect(masked.length).toBe(content.length);
    expect(quoteState).toBeNull();
  });

  it('bounds a // comment to the current line when content spans multiple lines', () => {
    // Some callers (docDrift/parseExpressRoutes.js) pass a whole multi-line
    // file as a single `content` string in one call, not threaded line by
    // line. A // comment must only mask up to its own line's newline, not
    // swallow the rest of the file.
    const content = 'const a = 1; // note {x}\nconst b = { y: 2 };';
    const { masked } = maskStringLiterals(content);
    expect(masked).toBe('const a = 1;            \nconst b = { y: 2 };');
    expect(masked.length).toBe(content.length);
  });

  it('masks a single-line /* */ block comment', () => {
    const content = 'fn(/* {opts} */ a, b);';
    const { masked, quoteState } = maskStringLiterals(content);
    expect(masked).toBe('fn(             a, b);');
    expect(masked.length).toBe(content.length);
    expect(quoteState).toBeNull();
  });

  it('threads block-comment state across lines for a multi-line /* */ comment', () => {
    const first = maskStringLiterals('async (req, res) => /* returns {', null);
    expect(first.quoteState).toBe('/*');
    const second = maskStringLiterals('  id, name } */ { try {} catch (e) {} }', first.quoteState);
    expect(second.masked).toBe('                { try {} catch (e) {} }');
    expect(second.quoteState).toBeNull();
  });

  it('does not treat a // inside a string literal as a comment', () => {
    const content = 'const url = "http://example.com/{id}";';
    const { masked } = maskStringLiterals(content);
    expect(masked).toBe('const url =                          ;');
    expect(masked.length).toBe(content.length);
  });
});

describe('maskComments', () => {
  it('masks a // line comment but leaves string content and code untouched', () => {
    const content = 'router.get("/health", h); // router.delete("/:id", r);';
    const { masked, quoteState } = maskComments(content);
    expect(masked).toBe('router.get("/health", h);                             ');
    expect(masked.length).toBe(content.length);
    expect(quoteState).toBeNull();
  });

  it('masks a /* */ block comment but leaves string content untouched', () => {
    const content = 'fn(/* router.post("/x", h); */ a, b);';
    const { masked } = maskComments(content);
    expect(masked).toBe('fn(                            a, b);');
    expect(masked.length).toBe(content.length);
  });

  it('does not treat a // or /* inside a string literal as a comment', () => {
    const content = 'const url = "http://example.com/* not a comment */";';
    const { masked } = maskComments(content);
    expect(masked).toBe(content);
  });

  it('does not mask a // that appears inside a string, even when a real comment follows', () => {
    const content = 'router.get("http://x", h); // trailing comment';
    const { masked } = maskComments(content);
    expect(masked.startsWith('router.get("http://x", h); ')).toBe(true);
    expect(masked).not.toContain('trailing');
    expect(masked.length).toBe(content.length);
  });

  it('threads block-comment state across lines for a multi-line /* */ comment', () => {
    const first = maskComments('router.get("/a", h); /* start', null);
    expect(first.quoteState).toBe('/*');
    const second = maskComments('  still commented */ router.post("/b", h);', first.quoteState);
    expect(second.masked).toBe('                     router.post("/b", h);');
    expect(second.masked.length).toBe('  still commented */ router.post("/b", h);'.length);
    expect(second.quoteState).toBeNull();
  });
});
