const { collectAddedLines } = require('../utils/collectAddedLines');

const ASYNC_HANDLER_SIGNATURE = /async\s*(\(|function)/;
const HANDLER_PARAMS = /req\s*,\s*res/;
const TRY_BLOCK = /\btry\s*{/;
const ASYNC_WRAPPER = /asyncHandler/;
const THEN_CALL = /\.then\s*\(/;
const CATCH_CALL = /\.catch\s*\(/;

// Collects the lines belonging to the .then() statement starting at
// addedLines[startIdx], from that line up through the line where the
// statement actually ends: parens balanced (depth <= 0) AND either the
// line ends with a `;`, or the following line isn't a `.`-prefixed chain
// continuation (so an unrelated next statement is never pulled in).
function collectThenStatement(addedLines, startIdx) {
  let depth = 0;
  const blockLines = [];
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const content = addedLines[i].content;
    if (i > startIdx && depth <= 0 && !content.trim().startsWith('.')) break;

    blockLines.push(content);
    for (const ch of content) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    if (depth <= 0 && /;\s*$/.test(content.trimEnd())) break;
  }
  return blockLines.join('\n');
}

// Collects the lines belonging to the handler block starting at
// addedLines[startIdx], bounded by that handler's own brace depth (from its
// first `{` back down to 0) rather than "up to the next handler's start
// line" — the latter sweeps in any unrelated code sitting between two
// handlers (e.g. a helper function with its own unrelated try/catch), which
// would otherwise satisfy TRY_BLOCK/ASYNC_WRAPPER for a handler that has no
// error handling of its own.
function collectHandlerBlock(addedLines, startIdx) {
  let depth = 0;
  let sawOpen = false;
  const blockLines = [];
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const content = addedLines[i].content;
    blockLines.push(content);
    for (const ch of content) {
      if (ch === '{') { depth += 1; sawOpen = true; } else if (ch === '}') depth -= 1;
    }
    if (sawOpen && depth <= 0) break;
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
      const block = collectHandlerBlock(addedLines, idx);
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
    // negative). collectThenStatement walks forward tracking paren depth
    // and stops at the statement's actual end (a balanced, semicolon-
    // terminated line, or the first following line that isn't a `.`
    // chain continuation), so the window always matches the real
    // boundary of the one chain being checked.
    addedLines.forEach((line, idx) => {
      if (!THEN_CALL.test(line.content)) return;
      const window = collectThenStatement(addedLines, idx);
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
