const { collectAddedLines } = require('../utils/collectAddedLines');
const { collectBoundedBlock } = require('../utils/collectBoundedBlock');
const { maskStringLiterals } = require('../utils/maskStringLiterals');

const ASYNC_HANDLER_SIGNATURE = /async\s*(\(|function)/;
const HANDLER_PARAMS = /req\s*,\s*res/;
const TRY_BLOCK = /\btry\s*{/;
const ASYNC_WRAPPER = /asyncHandler/;
const THEN_CALL = /\.then\s*\(/;
const CATCH_CALL = /\.catch\s*\(/;

// Collects the lines belonging to the single statement starting at
// addedLines[startIdx], from that line up through the line where the
// statement actually ends: parens balanced (depth <= 0) AND either the
// line ends with a `;`, or the following line isn't a `.`-prefixed chain
// continuation (so an unrelated next statement is never pulled in). This is
// a statement-boundary walk, not a brace-delimited block, so it can't reuse
// collectBoundedBlock (which stops strictly at open/close-char balance and,
// for an occurrence whose starting line never opens a brace at all, falls
// back to reading all the way to the end of input — see
// collectBoundedBlock.js's own "no opening brace at all" test case. That
// fallback is correct for *its* contract, but wrong for a statement-shaped
// occurrence: it would sweep every unrelated following statement into the
// window). Parens inside string/template literals (e.g. a callback body
// logging a message containing a literal ")") are masked out via
// maskStringLiterals first, so they can't be mistaken for the statement's
// real paren structure — same bug class and fix as collectBoundedBlock's,
// see CLAUDE.md's string-literal-aware depth-counting guideline.
// Shared by two occurrence shapes: a .then() chain (a statement that may
// have its own brace-delimited callback bodies nested inside its parens)
// and a brace-less/concise-body async handler (e.g.
// `async (req, res) => res.json(x);`, no `{` anywhere) — both need "this
// one statement's own lines, not whatever collectBoundedBlock's brace-only
// contract would sweep in when the statement never opens a brace on its own
// starting line.
function collectStatement(addedLines, startIdx) {
  let depth = 0;
  let quoteState = null;
  const blockLines = [];
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const content = addedLines[i].content;
    const { masked, quoteState: nextQuoteState } = maskStringLiterals(content, quoteState);
    quoteState = nextQuoteState;
    if (i > startIdx && depth <= 0 && !masked.trim().startsWith('.')) break;

    blockLines.push(content);
    for (const ch of masked) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    if (depth <= 0 && /;\s*$/.test(masked.trimEnd())) break;
  }
  return blockLines.join('\n');
}

function check(files) {
  const issues = [];
  for (const file of files) {
    const addedLines = collectAddedLines(file);

    // Handlers are analyzed per-block (each handler's own brace-bounded
    // body), not file-wide and not "up to the next handler": a try/catch or
    // asyncHandler wrapper on one handler — or on unrelated code sitting
    // between two handlers — must not silence the check for a sibling
    // handler in the same file diff.
    const handlerIndexes = [];
    addedLines.forEach((line, idx) => {
      if (ASYNC_HANDLER_SIGNATURE.test(line.content) && HANDLER_PARAMS.test(line.content)) {
        handlerIndexes.push(idx);
      }
    });

    handlerIndexes.forEach((idx) => {
      // collectBoundedBlock is only safe to use once the handler's own
      // starting line actually opens a brace: for an occurrence whose
      // starting line never opens one at all (a concise/expression-bodied
      // arrow handler, e.g. `async (req, res) => res.json(x);` — no `{`
      // anywhere), collectBoundedBlock's documented fallback for that case
      // is "read to the end of input" (see its own test of the same name),
      // which sweeps every unrelated statement/handler after this one into
      // the window and can satisfy TRY_BLOCK/ASYNC_WRAPPER off content that
      // has nothing to do with this handler. A brace-less handler can never
      // contain a `try { ... }` of its own regardless (that requires
      // braces), so it only needs its own statement's lines checked for an
      // ASYNC_WRAPPER match — collectStatement bounds that correctly.
      const { masked: firstLineMasked } = maskStringLiterals(addedLines[idx].content);
      const block = firstLineMasked.includes('{')
        ? collectBoundedBlock(addedLines, idx)
        : collectStatement(addedLines, idx);
      if (!TRY_BLOCK.test(block) && !ASYNC_WRAPPER.test(block)) {
        const line = addedLines[idx];
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'high',
          message: `Async route handler added without a try/catch or an asyncHandler wrapper: "${line.content.trim()}"`,
          fix: 'Wrap the handler body in try/catch (or wrap the handler itself with an asyncHandler utility) and forward errors to a catch-all error middleware.',
        });
      }
    });

    // Likewise, each .then() call is checked against its own statement —
    // not "does a .catch() appear anywhere in the file diff" (a caught
    // chain elsewhere must not silence an uncaught one), and not a fixed
    // N-line window either: a window that's too small misses a .catch()
    // that's genuinely part of the same chain a few lines down (false
    // positive on a real multi-line-formatted chain), while a window
    // that's too large can pull in an unrelated statement's .catch() and
    // silence a genuinely uncaught chain right next to it (false
    // negative). collectStatement walks forward tracking paren depth
    // and stops at the statement's actual end (a balanced, semicolon-
    // terminated line, or the first following line that isn't a `.`
    // chain continuation), so the window always matches the real
    // boundary of the one chain being checked.
    addedLines.forEach((line, idx) => {
      if (!THEN_CALL.test(line.content)) return;
      const window = collectStatement(addedLines, idx);
      if (!CATCH_CALL.test(window)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'medium',
          message: 'Promise chain uses .then() without a matching .catch() in this diff.',
          fix: 'Add a .catch() handler (or use try/catch with await) so a rejected promise cannot go unhandled.',
        });
      }
    });
  }
  return issues;
}

module.exports = { category: 'error-handling', check };
