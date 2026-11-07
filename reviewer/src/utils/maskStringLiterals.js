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

// A `/` starts a regex literal (not division) when the previous significant
// character cannot end an operand. Returns the index just past the closing
// `/` and flags, or -1 when this `/` is division or the literal does not
// close on this line. A brace or quote inside a regex (`/\{/`, `/'/`) would
// otherwise be read as real block structure or the start of a string.
const REGEX_PRECEDERS = '(,=:[!&|?{};+-*%<>~^';
function regexLiteralEnd(content, i, prev) {
  if (prev !== null && !REGEX_PRECEDERS.includes(prev)) return -1;
  // `i++ / 2` is division: a doubled +/- is a postfix operator, not a sign.
  if (/(\+\+|--)\s*$/.test(content.slice(0, i))) return -1;
  let inClass = false;
  for (let j = i + 1; j < content.length; j += 1) {
    const ch = content[j];
    if (ch === '\\') j += 1;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      let end = j + 1;
      while (end < content.length && /[a-z]/.test(content[end])) end += 1;
      return end;
    }
  }
  return -1;
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
  return maskCore(content, quoteState, true);
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
  return maskCore(content, quoteState, false);
}

// Scanner state is a stack of frames so a template literal nested inside a
// `${...}` interpolation of another template (`a ${x ? `{` : ''} b`) is
// tracked structurally instead of the inner backtick being read as the
// outer template's close (TASKS.md 36; guidelines 10/22). Frames: '"', "'",
// '`' (template text), '${' (interpolation expression), '{' (brace nested in
// an interpolation expression), '/*' (block comment). The stack is
// serialized as a space-joined string so `quoteState` stays an opaque
// null-or-string value for callers; a single-frame stack serializes to the
// legacy values ('"', "'", '`', '/*').
function parseState(quoteState) {
  return quoteState ? quoteState.split(' ') : [];
}

function maskCore(content, quoteState, maskStrings) {
  const stack = parseState(quoteState);
  let masked = '';
  let prev = null;
  let i = 0;
  // Strings mode: everything inside a template literal (text and
  // interpolation code alike) is blanked, as before the nesting fix.
  const out = (text) => {
    if (!maskStrings) return text;
    if (!stack.includes('`')) return text;
    return text.replace(/[^\n]/g, ' ');
  };
  const blankStr = (text) => (maskStrings ? text.replace(/[^\n]/g, ' ') : text);
  while (i < content.length) {
    const top = stack[stack.length - 1];
    const ch = content[i];
    if (top === '/*') {
      if (ch === '*' && content[i + 1] === '/') {
        stack.pop();
        masked += '  ';
        i += 2;
      } else {
        masked += blank(ch);
        i += 1;
      }
      continue;
    }
    if (top === '"' || top === "'" || top === '`') {
      if (ch === '\\') {
        // A backslash as the very last character of this chunk (a line-
        // continuation escape at the end of one line of a multi-line
        // template) has no next character in this chunk to escape; consume
        // only it so masked stays the same length as content. State stays
        // open either way.
        if (i + 1 >= content.length) {
          masked += blankStr(ch);
          i += 1;
        } else {
          masked += blankStr(ch + content[i + 1]);
          i += 2;
        }
        continue;
      }
      if (top === '`' && ch === '$' && content[i + 1] === '{') {
        stack.push('${');
        masked += blankStr('${');
        i += 2;
        prev = null;
        continue;
      }
      if (ch === top) {
        stack.pop();
        prev = ch;
      }
      masked += blankStr(ch);
      i += 1;
      continue;
    }
    // Code (top level, or inside an interpolation expression).
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
      stack.push('/*');
      continue;
    }
    if (ch === '/') {
      const end = regexLiteralEnd(content, i, prev);
      if (end !== -1) {
        masked += out(maskStrings ? ' '.repeat(end - i) : content.slice(i, end));
        i = end;
        prev = '/';
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      stack.push(ch);
      masked += maskStrings ? ' ' : ch;
      i += 1;
      continue;
    }
    if (top === '${' || top === '{') {
      if (ch === '{') {
        stack.push('{');
      } else if (ch === '}') {
        stack.pop();
        // Closing an interpolation returns to template text; its brace is
        // template syntax, so it is blanked like the opening `${`.
        masked += top === '${' ? blankStr(ch) : out(ch);
        i += 1;
        prev = ch;
        continue;
      }
    }
    masked += out(ch);
    if (ch.trim() !== '') prev = ch;
    i += 1;
  }
  return { masked, quoteState: stack.length ? stack.join(' ') : null };
}

module.exports = { maskStringLiterals, maskComments };
