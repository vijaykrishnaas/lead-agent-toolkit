const walk = require('acorn-walk');

// acorn-walk's own traversal descriptors, with function-node types
// overridden to enumerate no children -- so a full walk seeded with this
// base visits a nested function node itself but never descends into its
// body. Used to answer "does X occur in the subtree that actually executes
// as part of this function/statement" without crossing into an unrelated
// nested function's own separate execution scope.
const OWN_SCOPE_BASE = Object.assign({}, walk.base, {
  FunctionDeclaration: () => {},
  FunctionExpression: () => {},
  ArrowFunctionExpression: () => {},
});

// Walks `node`'s subtree looking for a node matching `predicate`, stopping
// at any nested function boundary (FunctionDeclaration, FunctionExpression,
// ArrowFunctionExpression) instead of descending into it. A try/catch, a
// .catch() call, or an await sitting inside an unrelated nested function
// defined within the block being checked belongs to that inner function's
// own execution, not the outer one -- treating it as if it did produces a
// false negative (an actually-unhandled outer handler/chain looks handled)
// or a false positive (an unrelated inner await gets blamed on the outer
// .forEach() callback), depending on the check. See CLAUDE.md guideline 2:
// a boundary must be derived from real structure, never aggregated beyond
// the actual occurrence -- this extends that to function scope, not just
// brace/paren depth.
function subtreeInOwnScope(node, predicate) {
  let found = false;
  walk.full(node, (n) => {
    if (predicate(n)) found = true;
  }, OWN_SCOPE_BASE);
  return found;
}

module.exports = { subtreeInOwnScope };
