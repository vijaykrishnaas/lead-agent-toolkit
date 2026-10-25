// Wraps untrusted text in an inline code span whose fence is longer than any
// backtick run inside it (CommonMark), with newlines collapsed, so a route
// path or file name containing a backtick/newline cannot close the span early
// and forge extra report lines (guideline 15: same sink class as markdownReport).
function codeSpan(text) {
  const flat = String(text).replace(/\r\n|\r|\n/g, ' ');
  const longest = Math.max(0, ...(flat.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  // CommonMark also strips one space from each side when both are present, so
  // pad in that case too or a name with surrounding spaces renders trimmed.
  const pad = flat.startsWith('`') || flat.endsWith('`') || (/^ .* $/.test(flat) && /[^ ]/.test(flat)) ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

module.exports = { codeSpan };
