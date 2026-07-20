const { parseDiff } = require('./diffParser');
const defaultRules = require('./rules');
const { resolveFileContent } = require('./utils/resolveFileContent');

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function computeRisk(issues) {
  if (issues.length === 0) return 'none';
  const maxRank = Math.max(...issues.map((issue) => SEVERITY_RANK[issue.severity] || 1));
  return Object.keys(SEVERITY_RANK).find((key) => SEVERITY_RANK[key] === maxRank);
}

// `options.execGit`/`repo`/`sha`, when all three are given (the CLI has
// repo access and resolved a head sha -- see cli.js), are used to attach
// each file's resolved post-image content, letting rules that support it
// (currently error-handling, performance) use their AST-based path instead
// of the diff-only text/regex fallback. Callers that only pass diffText
// (e.g. every existing unit test, or a bare diff with no repo access) get
// the exact same rule.check(files) interface and behavior as before --
// content resolution is opt-in and additive, never required.
function reviewDiff(diffText, rules = defaultRules, options = {}) {
  const files = parseDiff(diffText);

  if (options.execGit && options.repo && options.sha) {
    for (const file of files) {
      const content = resolveFileContent({
        execGit: options.execGit,
        repo: options.repo,
        sha: options.sha,
        path: file.file,
      });
      if (content !== null) file.content = content;
    }
  }

  const issues = [];

  for (const rule of rules) {
    const found = rule.check(files) || [];
    for (const issue of found) {
      issues.push({
        file: issue.file,
        line: issue.line,
        category: rule.category,
        severity: issue.severity,
        message: issue.message,
        fix: issue.fix,
      });
    }
  }

  return { risk: computeRisk(issues), issues };
}

module.exports = { reviewDiff, parseDiff, defaultRules };
