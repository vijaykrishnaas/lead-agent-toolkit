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
  const options = { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true };
  try {
    return acorn.parse(content, { ...options, sourceType: 'script' });
  } catch (scriptError) {
    // import/export (ESM) is a syntax error under sourceType 'script'; retry
    // as a module so ES-module files still get the AST path instead of
    // silently falling back to the regex walkers. A file invalid either way
    // rethrows the original script-mode error.
    try {
      return acorn.parse(content, { ...options, sourceType: 'module' });
    } catch (moduleError) {
      throw scriptError;
    }
  }
}

module.exports = { parseAst };
