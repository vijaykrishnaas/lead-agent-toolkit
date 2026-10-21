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

  // A `--- `/`+++ ` line is a file header only as a `---`,`+++`,`@@` triple;
  // inside a hunk it is a deleted `-- x` / added `++ x` content line.
  const isFileHeaderStart = (i) =>
    lines[i].startsWith('--- ') && lines[i + 1] !== undefined && lines[i + 1].startsWith('+++ ') &&
    (lines[i + 2] === undefined || lines[i + 2].startsWith('@@') || !currentHunk);

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine.startsWith('diff --git')) {
      currentFile = null;
      currentHunk = null;
      continue;
    }
    if (isFileHeaderStart(i)) {
      continue;
    }
    if (rawLine.startsWith('+++ ') && lines[i - 1] !== undefined && lines[i - 1].startsWith('--- ') && isFileHeaderStart(i - 1)) {
      let path = stripPrefix(rawLine.slice(4).trim());
      // A deleted file's post-image header is `+++ /dev/null`; name it by the
      // pre-image path instead.
      if (path === '/dev/null') path = stripPrefix(lines[i - 1].slice(4).trim());
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
