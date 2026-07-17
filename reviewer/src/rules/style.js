const { collectAddedLines } = require('../utils/collectAddedLines');

const VAR_DECLARATION = /^\s*var\s+/;
const CONSOLE_LOG = /console\.log\s*\(/;

function isTestFile(path) {
  return /(^|\/)tests\//.test(path) || /\.test\.js$/.test(path);
}

function check(files) {
  const issues = [];
  for (const file of files) {
    if (isTestFile(file.file)) continue;
    for (const line of collectAddedLines(file)) {
      if (VAR_DECLARATION.test(line.content)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'low',
          message: `"var" declaration added: "${line.content.trim()}"`,
          fix: 'Use "let" or "const" instead of "var".',
        });
      }
      if (CONSOLE_LOG.test(line.content)) {
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
