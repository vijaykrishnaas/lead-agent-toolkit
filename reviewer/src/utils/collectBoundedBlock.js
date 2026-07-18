// Collects the lines belonging to a single brace-delimited block starting at
// addedLines[startIdx], from that line's first opening brace up through the
// line containing its matching closing brace (tracked by brace depth), so an
// occurrence's own body — and only its own body — is what gets returned.
// Bounding by brace depth, rather than "up to the next occurrence's start
// line," matters because unrelated content (a helper function, a sibling
// statement) can sit between two occurrences of the same construct; using
// the next occurrence's start as the boundary would sweep that unrelated
// content's own markers (e.g. its own try/catch) into the current
// occurrence's block, hiding a genuinely non-compliant occurrence next to a
// compliant one. See CLAUDE.md's per-occurrence-scoping guideline for the
// bug class this closes off structurally, shared by errorHandling.js's
// handler-block check and performance.js's forEach-block check.
function collectBoundedBlock(addedLines, startIdx) {
  let depth = 0;
  let opened = false;
  const blockLines = [];
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const content = addedLines[i].content;
    blockLines.push(content);
    for (const ch of content) {
      if (ch === '{') {
        depth += 1;
        opened = true;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) break;
  }
  return blockLines.join('\n');
}

module.exports = { collectBoundedBlock };
