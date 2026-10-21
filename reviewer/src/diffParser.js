function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    oldStart: parseInt(match[1], 10),
    newStart: parseInt(match[3], 10),
  };
}

const QUOTED_ESCAPES = { n: '\n', t: '\t', '"': '"', '\\': '\\' };

// Git wraps paths with special characters in double quotes and C-escapes them
// (non-ASCII bytes as octal), so decode before stripping the a/ b/ prefix.
function unquotePath(path) {
  if (!(path.length >= 2 && path.startsWith('"') && path.endsWith('"'))) return path;
  const bytes = [];
  const inner = path.slice(1, -1);
  for (let i = 0; i < inner.length; i += 1) {
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1, i + 4));
    if (inner[i] === '\\' && octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (inner[i] === '\\' && QUOTED_ESCAPES[inner[i + 1]] !== undefined) {
      bytes.push(...Buffer.from(QUOTED_ESCAPES[inner[i + 1]]));
      i += 1;
    } else {
      bytes.push(...Buffer.from(inner[i]));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(path) {
  return unquotePath(path).replace(/^[ab]\//, '');
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
      const deleted = path === '/dev/null';
      if (deleted) path = stripPrefix(lines[i - 1].slice(4).trim());
      currentFile = { file: path, hunks: [] };
      if (deleted) currentFile.deleted = true;
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
