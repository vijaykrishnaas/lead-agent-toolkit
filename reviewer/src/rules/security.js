const { collectAddedLines } = require('../utils/collectAddedLines');

const SECRET_PATTERN = /(password|secret|apikey|api_key|token)\s*[:=]\s*['"`][^'"`]{3,}['"`]/i;
const ENV_PATTERN = /process\.env/;
const EVAL_PATTERN = /\beval\s*\(/;

function check(files) {
  const issues = [];
  for (const file of files) {
    for (const line of collectAddedLines(file)) {
      if (SECRET_PATTERN.test(line.content) && !ENV_PATTERN.test(line.content)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'high',
          message: `Possible hardcoded credential: "${line.content.trim()}"`,
          fix: 'Load secrets from environment variables or a secrets manager instead of hardcoding them.',
        });
      }
      if (EVAL_PATTERN.test(line.content)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'high',
          message: `Use of eval(): "${line.content.trim()}"`,
          fix: 'Avoid eval(); use a safer alternative (e.g. JSON.parse, explicit parsing) to prevent code injection.',
        });
      }
    }
  }
  return issues;
}

module.exports = { category: 'security', check };
