const { collectAddedLines } = require('../utils/collectAddedLines');

const SECRET_PATTERN = /(password|secret|apikey|api_key|token)\s*[:=]\s*['"`][^'"`]{3,}['"`]/i;
// \beval\s*\( catches the direct call form (`eval(x)`). It does not catch
// bracket-property access (`global['eval'](x)`, `window["eval"](x)`), a
// trivial one-line evasion with identical runtime semantics: `eval` there is
// followed by `]`, not `(`, so the word-boundary form never matches. The
// second alternative catches that shape directly (quoted "eval" inside
// brackets, immediately invoked).
const EVAL_PATTERN = /\beval\s*\(|\[\s*(['"])eval\1\s*\]\s*\(/;

// No process.env exemption here: SECRET_PATTERN only matches when the
// operator is immediately followed by a quoted literal, which a genuine
// `= process.env.X` read never is (there's no quote around a property
// access) — so a whole-line "does this mention process.env anywhere"
// guard was never needed for that case, and it actively created a bypass:
// a real hardcoded literal followed by a trailing `|| process.env.X`
// fallback, or even just a `// see process.env.X` comment on the same
// line, would silently suppress the finding for a genuine hardcoded
// secret.
function check(files) {
  const issues = [];
  for (const file of files) {
    for (const line of collectAddedLines(file)) {
      if (SECRET_PATTERN.test(line.content)) {
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
