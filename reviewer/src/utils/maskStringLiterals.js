// A literal newline masked to a space would merge two source lines into
// one inside `masked` -- harmless for callers that mask one diff line at a
// time (a line's own content never contains an embedded '\n' to begin
// with), but a real corruption for a caller that masks a whole multi-line
// file as one string (e.g. docDrift/parseExpressRoutes.js's findUnparsedRoutes,
// which derives a match's reported line number by counting '\n' characters
// in the masked text up to that match): a multi-line template literal or
// `/* */` block comment would silently swallow its own embedded newlines,
// undercounting every line number computed from text after it. Preserving
// the newline itself (still not a string/comment *content* character
// structurally, so it can't be mistaken for a brace/paren/keyword either)
// keeps both the "same length" and "same line count" invariants.
function blank(ch) {
  return ch === '\n' ? '\n' : ' ';
}

// Replaces the contents of single/double-quoted and template-literal
// strings, `//` line comments, and `/* */` block comments in `content` with
// spaces (same length, so column positions and non-string/non-comment
// characters are preserved), so a caller counting structural characters
// (braces, parens) doesn't mistake a brace/paren that only exists inside a
// string literal *or a comment* for real code structure. Escaped quote
// characters (`\"`, `\\`, etc.) don't end the string early. `quoteState`
// (one of `"`, `'`, `` ` ``, `/*` -- meaning "inside an unterminated block
// comment" -- or null) threads across calls so a template literal or block
// comment spanning multiple lines doesn't fool the scanner into ending it
// early on the first line or never closing it on a later one. A `//` line
// comment never needs to thread state across calls -- it always ends at the
// next newline (or the end of `content` if there is none) -- but callers
// that pass a whole multi-line file as a single `content` string (e.g.
// docDrift/parseExpressRoutes.js) still need it bounded to that next
// newline rather than masked to the end of the entire string. (Evidence:
// PROGRESS.md -- errorHandling.js's collectBoundedBlock/handlerHasBraceBody
// treated a `{`/`}` pair inside a same-line trailing comment on a handler's
// signature line, e.g. `async (req, res) => // returns {id, name}`, as the
// handler's real opening/closing brace, terminating the block scan after
// just the signature line and missing the handler's actual try/catch body
// entirely -- a false positive against fully compliant code. Comments were
// the one non-code-structure text category maskStringLiterals didn't
// already neutralize, despite doing exactly this for string literals.)
function maskStringLiterals(content, quoteState = null) {
  let masked = '';
  let state = quoteState;
  let i = 0;
  while (i < content.length) {
    if (state === '/*') {
      if (content[i] === '*' && content[i + 1] === '/') {
        masked += '  ';
        i += 2;
        state = null;
      } else {
        masked += blank(content[i]);
        i += 1;
      }
      continue;
    }
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
        masked += ' ' + blank(content[i + 1]);
        i += 2;
        continue;
      }
      if (ch === state) state = null;
      masked += blank(ch);
      i += 1;
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      let end = content.indexOf('\n', i);
      if (end === -1) end = content.length;
      masked += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      masked += '  ';
      i += 2;
      state = '/*';
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

// Like maskStringLiterals, but masks only `//` and `/* */` comments to
// same-length spaces -- string/template literal contents (including their
// quote characters) are copied through unchanged. Quote state is still
// tracked internally (so a `//`/`/*` sequence *inside* a string isn't
// mistaken for the start of a comment), it's just not used to blank
// anything. For callers that need to keep matching a regex against real
// source text (e.g. extracting a quoted path argument via a capture group)
// while still refusing to match inside a comment -- a plain
// maskStringLiterals() call would blank the string content those callers
// need to capture, along with the comment they want ignored.
function maskComments(content, quoteState = null) {
  let masked = '';
  let state = quoteState;
  let i = 0;
  while (i < content.length) {
    if (state === '/*') {
      if (content[i] === '*' && content[i + 1] === '/') {
        masked += '  ';
        i += 2;
        state = null;
      } else {
        masked += blank(content[i]);
        i += 1;
      }
      continue;
    }
    const ch = content[i];
    if (state) {
      if (ch === '\\') {
        if (i + 1 >= content.length) {
          masked += ch;
          i += 1;
          continue;
        }
        masked += ch + content[i + 1];
        i += 2;
        continue;
      }
      if (ch === state) state = null;
      masked += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      let end = content.indexOf('\n', i);
      if (end === -1) end = content.length;
      masked += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      masked += '  ';
      i += 2;
      state = '/*';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      state = ch;
      masked += ch;
      i += 1;
      continue;
    }
    masked += ch;
    i += 1;
  }
  return { masked, quoteState: state };
}

module.exports = { maskStringLiterals, maskComments };
