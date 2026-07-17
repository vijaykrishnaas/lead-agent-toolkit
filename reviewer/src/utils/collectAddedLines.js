function collectAddedLines(fileEntry) {
  const added = [];
  for (const hunk of fileEntry.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') added.push(line);
    }
  }
  return added;
}

module.exports = { collectAddedLines };
