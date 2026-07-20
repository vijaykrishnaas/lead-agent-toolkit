// Reconstructs each file's post-image content by concatenating its hunks'
// context + added lines, in order, dropping deleted lines. This is only a
// valid stand-in for `git show <sha>:<path>` when a file's hunk(s) cover the
// entire file with no gaps -- true for every fixture in this test suite
// (each one is a single hunk starting at old line 1) but not a general
// diff-to-full-file reconstructor. Used to drive the same fixtures already
// covering the regex/text-boundary path through the AST path as well: see
// CLAUDE.md AUDIT.md F3 / task 23, "all existing rule fixtures become the
// acceptance suite". A file whose reconstructed text happens not to be
// valid standalone JS (some fixtures are intentionally minimal snippets,
// not complete files) still exercises the intended behavior end-to-end,
// because the rule itself falls back to the regex path on a parse failure.
function reconstructFileContent(files) {
  return files.map((file) => {
    const lines = [];
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add' || line.type === 'context') lines.push(line.content);
      }
    }
    return { ...file, content: lines.join('\n') };
  });
}

module.exports = { reconstructFileContent };
