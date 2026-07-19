// Free-text values interpolated into a markdown report can come from sources
// an external, non-owning contributor controls (a commit message/PR title in
// the standup report; a diff-controlled `line.content` embedded in a rule's
// `issue.message`/`issue.fix` in the review report) and must be neutralized
// before interpolation: embedded newlines are collapsed (otherwise a
// multi-line value can forge extra report lines — e.g. a fake "## Section"
// heading — inside what should render as a single list item), and
// markdown-structural characters (backtick, *, _, [, ], (, )) are
// backslash-escaped — including the parens, so no unescaped "](" substring
// survives — so a value like "[x](javascript:...)" or a hardcoded-credential
// finding that happens to quote a crafted `[Approve without review](https://
// evil.example)` link renders as inert text instead of a live, clickable
// link. Shared by both the standup report and the review report — the
// review report posts live to GitHub PR comments via postReviewComment, so
// it is the higher-impact of the two surfaces.
function sanitizeMarkdownText(text) {
  return String(text)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[`*_[\]()]/g, '\\$&');
}

module.exports = { sanitizeMarkdownText };
