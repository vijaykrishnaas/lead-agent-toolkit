// Replaces the contents of single/double-quoted and template-literal strings
// in `content` with spaces (same length, so column positions and non-string
// characters are preserved), so a caller counting structural characters
// (braces, parens) doesn't mistake a brace/paren that only exists inside a
// string literal for real code structure. Escaped quote characters (`\"`,
// `\\`, etc.) don't end the string early. `quoteState` (one of `"`, `'`,
// `` ` ``, or null) threads across calls so a template literal spanning
// multiple lines doesn't fool the scanner into ending the string early on
// the first line or never closing it on a later one.
function maskStringLiterals(content, quoteState = null) {
  let masked = '';
  let state = quoteState;
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (state) {
      if (ch === '\\') {
        masked += '  ';
        i += 2;
        continue;
      }
      if (ch === state) state = null;
      masked += ' ';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      state = ch;
      masked += ' ';
      i += 1;
      continue;
    }
    masked += ch;
    i += 1;
  }
  return { masked, quoteState: state };
}

module.exports = { maskStringLiterals };
