const { collectAddedLines } = require('../utils/collectAddedLines');
const { maskStringLiterals } = require('../utils/maskStringLiterals');

const VAR_DECLARATION = /^\s*var\s+/;
const CONSOLE_LOG = /console\.log\s*\(/;

function isTestFile(path) {
  return /(^|\/)tests\//.test(path) || /\.test\.js$/.test(path);
}

// Matched against the line's string/comment-masked content, not the raw
// text -- a string literal that merely *mentions* "console.log(" (e.g. a log
// message like `"call console.log(x) to debug"`, quoted verbatim into an
// added line) satisfied CONSOLE_LOG against raw text exactly as if it were a
// real, executing call, producing a false positive with no actual debug
// statement in the code. `line.content` is a single diff line with no
// visibility into a preceding line's open string/template state, so
// maskStringLiterals is called fresh (quoteState = null) per line -- the
// same per-line-only scoping every other rule that walks collectAddedLines
// already has, not a new limitation introduced here.
function check(files) {
  const issues = [];
  for (const file of files) {
    if (isTestFile(file.file)) continue;
    for (const line of collectAddedLines(file)) {
      const { masked } = maskStringLiterals(line.content);
      if (VAR_DECLARATION.test(masked)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'low',
          message: `"var" declaration added: "${line.content.trim()}"`,
          fix: 'Use "let" or "const" instead of "var".',
        });
      }
      if (CONSOLE_LOG.test(masked)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'low',
          message: `console.log left in source: "${line.content.trim()}"`,
          fix: 'Remove debug console.log calls, or replace them with a real logger.',
        });
      }
    }
  }
  return issues;
}

module.exports = { category: 'style', check };
