const { maskStringLiterals } = require('./maskStringLiterals');

// Shared "walk lines from a starting occurrence, mask string/template
// literals and comments, track paren depth, and check-before-scan whether
// the statement has already ended" loop -- previously duplicated, nearly
// character-for-character, between errorHandling.js's collectStatement and
// findHandlerBraceStart (see AUDIT.md F9; run 6's PROGRESS.md entry already
// flagged the duplication after fixing a scan-vs-check ordering divergence
// between the two copies).
//
// A line is treated as "the statement already ended" once paren depth is
// back to <= 0, the line is non-blank/non-comment-only, and it isn't a
// `.`-chain continuation -- checked *before* that line is added to `lines`
// or scanned character-by-character, so an unrelated following
// statement/handler is never swept into the walk. `exemptLeadingBrace`
// (set by findHandlerBraceStart, not collectStatement) additionally exempts
// a line whose trimmed content itself starts with `{`: that's the shape of
// a legitimate real body brace sitting alone on its own line (e.g. after a
// comment between the signature and the brace), which must fall through to
// the character scan below instead of being treated as proof the statement
// already ended.
//
// `startColumn` slices only the starting line, so a caller matching a
// signature partway through its own line (e.g. `async` mid-line, as
// findHandlerBraceStart does) can begin the walk exactly at that match
// instead of column 0; collectStatement doesn't need this and omits it.
//
// `onChar(ch, depth, lineIndex, column)`, if provided, is invoked once per
// masked character on every line that's reached (depth reflects the
// running paren depth immediately before this character's own `(`/`)`
// effect, if any, is applied -- the same value the original per-line scans
// tested a `{` character against). Returning a truthy value stops the walk
// immediately and that value becomes the result's `found` field -- this is
// how findHandlerBraceStart locates the real body brace without collecting
// every line into memory first.
//
// Returns `{ lines, found }`. `lines` is every line visited before the walk
// stopped, each as `{ index, content, masked, trimmed }` (`content` is the
// raw, unmasked text -- sliced by `startColumn` only for the starting
// line); collectStatement joins these directly. The line that triggered an
// "already ended" stop is never included.
function walkStatement(addedLines, startIdx, { startColumn = 0, exemptLeadingBrace = false, onChar } = {}) {
  let depth = 0;
  let quoteState = null;
  const lines = [];
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const content = i === startIdx ? addedLines[i].content.slice(startColumn) : addedLines[i].content;
    const { masked, quoteState: nextQuoteState } = maskStringLiterals(content, quoteState);
    quoteState = nextQuoteState;
    const trimmed = masked.trim();

    const alreadyEnded =
      i > startIdx &&
      depth <= 0 &&
      trimmed !== '' &&
      !trimmed.startsWith('.') &&
      !(exemptLeadingBrace && trimmed.startsWith('{'));
    if (alreadyEnded) {
      return { lines, found: null };
    }

    lines.push({ index: i, content, masked, trimmed });

    for (let c = 0; c < masked.length; c += 1) {
      const ch = masked[c];
      const depthBeforeChar = depth;
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      if (onChar) {
        const hit = onChar(ch, depthBeforeChar, i, (i === startIdx ? startColumn : 0) + c);
        if (hit) return { lines, found: hit };
      }
    }

    if (depth <= 0 && trimmed !== '' && /;\s*$/.test(masked.trimEnd())) {
      return { lines, found: null };
    }
  }
  return { lines, found: null };
}

module.exports = { walkStatement };
