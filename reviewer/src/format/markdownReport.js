const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function severityBadge(severity) {
  if (severity === 'high') return '🔴 high';
  if (severity === 'medium') return '🟡 medium';
  return '🟢 low';
}

function groupByCategory(issues) {
  const groups = new Map();
  for (const issue of issues) {
    if (!groups.has(issue.category)) groups.set(issue.category, []);
    groups.get(issue.category).push(issue);
  }
  for (const categoryIssues of groups.values()) {
    categoryIssues.sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file);
    });
  }
  return groups;
}

// Renders a reviewDiff() result ({ risk, issues }) as a markdown report.
// meta is optional context (e.g. { range: 'base..head' }) shown in the header.
function formatMarkdownReport(result, meta = {}) {
  const { risk, issues } = result;
  const lines = ['# Code Review Report', ''];

  if (meta.range) lines.push(`**Range:** \`${meta.range}\``);
  lines.push(`**Risk:** ${risk}`, `**Issues found:** ${issues.length}`, '');

  if (issues.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n') + '\n';
  }

  const groups = groupByCategory(issues);
  for (const [category, categoryIssues] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${category} (${categoryIssues.length})`, '');
    for (const issue of categoryIssues) {
      lines.push(`- **${issue.file}:${issue.line}** [${severityBadge(issue.severity)}] — ${issue.message}`);
      lines.push(`  - Fix: ${issue.fix}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

module.exports = { formatMarkdownReport };
