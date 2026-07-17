const { parseDiff } = require('./diffParser');
const defaultRules = require('./rules');

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function computeRisk(issues) {
  if (issues.length === 0) return 'none';
  const maxRank = Math.max(...issues.map((issue) => SEVERITY_RANK[issue.severity] || 1));
  return Object.keys(SEVERITY_RANK).find((key) => SEVERITY_RANK[key] === maxRank);
}

function reviewDiff(diffText, rules = defaultRules) {
  const files = parseDiff(diffText);
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
