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
    const combinedAdded = addedLines.map((line) => line.content).join('\n');
    const hasTry = TRY_BLOCK.test(combinedAdded);
    const hasAsyncWrapper = ASYNC_WRAPPER.test(combinedAdded);
    const hasCatch = CATCH_CALL.test(combinedAdded);

    for (const line of addedLines) {
      if (ASYNC_HANDLER_SIGNATURE.test(line.content) && HANDLER_PARAMS.test(line.content)) {
        if (!hasTry && !hasAsyncWrapper) {
          issues.push({
            file: file.file,
            line: line.newLine,
            severity: 'high',
            message: `Async route handler added without a try/catch or an asyncHandler wrapper: "${line.content.trim()}"`,
            fix: 'Wrap the handler body in try/catch (or wrap the handler itself with an asyncHandler utility) and forward errors to a catch-all error middleware.',
          });
        }
      }
    }

    if (THEN_CALL.test(combinedAdded) && !hasCatch) {
      const thenLine = addedLines.find((line) => THEN_CALL.test(line.content));
      issues.push({
        file: file.file,
        line: thenLine.newLine,
        severity: 'medium',
        message: 'Promise chain uses .then() without a matching .catch() in this diff.',
        fix: 'Add a .catch() handler (or use try/catch with await) so a rejected promise cannot go unhandled.',
      });
    }
  }
  return issues;
}

module.exports = { category: 'error-handling', check };
