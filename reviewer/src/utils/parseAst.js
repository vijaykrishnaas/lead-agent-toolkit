const acorn = require('acorn');

// Parses a full (post-image) file's source into an acorn AST with location
// info. Throws on invalid/unparsable source (e.g. a reconstructed diff
// fragment that isn't valid standalone JS, or a genuine syntax error) --
// callers are expected to catch and fall back to the text/regex-based
// boundary derivation for that file. See CLAUDE.md AUDIT.md F3: the
// hand-rolled brace/paren boundary walkers this is meant to replace re-
// implement a JS lexer by hand and keep recurring the same bug class; a
// real parser sidesteps it structurally wherever full file content is
// resolvable.
function parseAst(content) {
  return acorn.parse(content, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
    allowReturnOutsideFunction: true,
  });
}

module.exports = { parseAst };
