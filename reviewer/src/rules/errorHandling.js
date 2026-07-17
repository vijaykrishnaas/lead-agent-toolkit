const { collectAddedLines } = require('../utils/collectAddedLines');

const ASYNC_HANDLER_SIGNATURE = /async\s*(\(|function)/;
const HANDLER_PARAMS = /req\s*,\s*res/;
const TRY_BLOCK = /\btry\s*{/;
const ASYNC_WRAPPER = /asyncHandler/;
const THEN_CALL = /\.then\s*\(/;
const CATCH_CALL = /\.catch\s*\(/;

function check(files) {
  const issues = [];
  for (const file of files) {
    const addedLines = collectAddedLines(file);

    // Handlers are analyzed per-block (from one handler signature up to the
    // next), not file-wide: a try/catch or asyncHandler wrapper on one
    // handler must not silence the check for a sibling handler in the same
    // file diff.
    const handlerIndexes = [];
    addedLines.forEach((line, idx) => {
      if (ASYNC_HANDLER_SIGNATURE.test(line.content) && HANDLER_PARAMS.test(line.content)) {
        handlerIndexes.push(idx);
      }
    });

    handlerIndexes.forEach((idx, i) => {
      const blockEnd = i + 1 < handlerIndexes.length ? handlerIndexes[i + 1] : addedLines.length;
      const block = addedLines
        .slice(idx, blockEnd)
        .map((line) => line.content)
        .join('\n');
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

    // Likewise, each .then() call is checked against a small local window
    // rather than "does a .catch() appear anywhere in the file diff" — a
    // caught chain elsewhere in the file must not silence an uncaught one.
    addedLines.forEach((line, idx) => {
      if (!THEN_CALL.test(line.content)) return;
      const windowEnd = Math.min(idx + 3, addedLines.length);
      const window = addedLines
        .slice(idx, windowEnd)
        .map((l) => l.content)
        .join('\n');
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
