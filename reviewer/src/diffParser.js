function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    oldStart: parseInt(match[1], 10),
    newStart: parseInt(match[3], 10),
  };
}

function stripPrefix(path) {
  return path.replace(/^[ab]\//, '');
}

function parseDiff(diffText) {
  const lines = diffText.split('\n');
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git')) {
      currentFile = null;
      currentHunk = null;
      continue;
    }
    if (rawLine.startsWith('--- ')) {
      continue;
    }
    if (rawLine.startsWith('+++ ')) {
      const path = stripPrefix(rawLine.slice(4).trim());
      currentFile = { file: path, hunks: [] };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }
    if (rawLine.startsWith('@@')) {
      const header = parseHunkHeader(rawLine);
      if (!header || !currentFile) continue;
      oldLine = header.oldStart;
      newLine = header.newStart;
      currentHunk = { header: rawLine, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (rawLine.startsWith('\\ No newline')) continue;

    if (rawLine.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: rawLine.slice(1), newLine, oldLine: null });
      newLine += 1;
    } else if (rawLine.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', content: rawLine.slice(1), newLine: null, oldLine });
      oldLine += 1;
    } else if (rawLine.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', content: rawLine.slice(1), newLine, oldLine });
      newLine += 1;
      oldLine += 1;
    }
  }

  return files;
}

module.exports = { parseDiff };
