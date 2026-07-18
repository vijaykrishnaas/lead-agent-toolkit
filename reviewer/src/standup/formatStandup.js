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
    // meta.since reflects the actual queried window (it can be an arbitrary
    // date via the CLI's --since flag, not always "24h ago"), so the no-
    // activity message must not hardcode "last 24h" when a custom since is
    // given — that reads as self-contradictory next to the "**Since:**" line
    // above it (e.g. "**Since:** 2020-01-01 ... in the last 24h.").
    const noActivityMessage = meta.since
      ? `No commits or pull requests since ${meta.since}.`
      : 'No commits or pull requests in the last 24h.';
    lines.push(noActivityMessage);
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
      for (const commit of [...commits].sort((a, b) => new Date(a.date) - new Date(b.date))) {
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
