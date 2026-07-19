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
        // A backslash as the very last character of this chunk (e.g. one
        // line of a multi-line template literal ending in a line-
        // continuation escape, `` `...text \ `` then a newline) has no next
        // character *in this chunk* to escape -- content[i + 1] doesn't
        // exist here, it's on whatever the caller passes in the next call.
        // Consuming 2 characters via `i += 2` in that case would step past
        // content.length after appending 2 spaces for only 1 real character
        // consumed, breaking the documented same-length invariant (masked
        // ends up 1 char longer than content) -- not observed to affect any
        // current caller's own char-counting logic, but real and caught by
        // the length assertion this fix adds a regression test for. The
        // backslash itself still just becomes one space, and `state` stays
        // open (correct: a line-continuation escape doesn't close the
        // string either way).
        if (i + 1 >= content.length) {
          masked += ' ';
          i += 1;
          continue;
        }
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
