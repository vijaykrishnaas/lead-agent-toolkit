// Returns the line a member-call CallExpression's own method name sits on
// (e.g. the `.then`/`.forEach`/`.parse` token), not the CallExpression's
// overall start line. For a multi-line chain (`promise\n  .then(...)`),
// `node.loc.start.line` is the *base object's* line ("promise"), not the
// line the call itself -- and the diff -- actually touched: a chain
// continuation appended to an already-existing base statement has the base
// object's line absent from `addedLineNumbers`, so scoping the check to
// `node.loc.start.line` silently drops a genuinely-added, genuinely-uncaught
// call. Using the callee property's own location instead makes both the
// diff-scoping check and the reported line match the token that was
// actually added. See CLAUDE.md guideline 2/23 -- same boundary-derivation
// class, applied to AST node location instead of brace/paren counting.
function memberCallLine(node) {
  return node.callee.type === 'MemberExpression' ? node.callee.property.loc.start.line : node.loc.start.line;
}

module.exports = { memberCallLine };
