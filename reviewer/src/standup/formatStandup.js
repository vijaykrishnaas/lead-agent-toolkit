function formatCommitLine(commit) {
  return `- \`${commit.hash.slice(0, 7)}\` ${commit.message}`;
}

function formatPullRequestLine(pr) {
  return `- #${pr.number} ${pr.title} (${pr.state})`;
}

// Renders a groupByAuthor() result (Map<author, { commits, pullRequests }>)
// as a per-author standup markdown report. meta is optional context
// (e.g. { since: '2026-07-17T00:00:00.000Z' }) shown in the header.
function formatStandupReport(groups, meta = {}) {
  const lines = ['# Standup', ''];
  if (meta.since) lines.push(`**Since:** ${meta.since}`, '');

  if (groups.size === 0) {
    lines.push('No commits or pull requests in the last 24h.');
    return lines.join('\n') + '\n';
  }

  for (const [author, { commits, pullRequests }] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${author}`, '');

    if (commits.length === 0 && pullRequests.length === 0) {
      lines.push('_No activity._', '');
      continue;
    }

    if (commits.length > 0) {
      lines.push('**Commits:**');
      for (const commit of [...commits].sort((a, b) => a.date.localeCompare(b.date))) {
        lines.push(formatCommitLine(commit));
      }
      lines.push('');
    }

    if (pullRequests.length > 0) {
      lines.push('**Pull requests:**');
      for (const pr of [...pullRequests].sort((a, b) => a.number - b.number)) {
        lines.push(formatPullRequestLine(pr));
      }
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

module.exports = { formatStandupReport };
