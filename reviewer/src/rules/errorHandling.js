const walk = require('acorn-walk');
const { collectAddedLines } = require('../utils/collectAddedLines');
const { collectBoundedBlock } = require('../utils/collectBoundedBlock');
const { maskStringLiterals } = require('../utils/maskStringLiterals');
const { memberCallLine } = require('../utils/memberCallLine');
const { parseAst } = require('../utils/parseAst');
const { subtreeInOwnScope } = require('../utils/subtreeInOwnScope');

const ASYNC_HANDLER_SIGNATURE = /async\s*(\(|function)/;
const HANDLER_PARAMS = /req\s*,\s*res/;
const TRY_BLOCK = /\btry\s*{/;
const ASYNC_WRAPPER = /asyncHandler/;
const THEN_CALL = /\.then\s*\(/;
const CATCH_CALL = /\.catch\s*\(/;

// Collects the lines belonging to the single statement starting at
// addedLines[startIdx], from that line up through the line where the
// statement actually ends: parens balanced (depth <= 0) AND either the
// line ends with a `;`, or the following line isn't a `.`-prefixed chain
// continuation (so an unrelated next statement is never pulled in). This is
// a statement-boundary walk, not a brace-delimited block, so it can't reuse
// collectBoundedBlock (which stops strictly at open/close-char balance and,
// for an occurrence whose starting line never opens a brace at all, falls
// back to reading all the way to the end of input — see
// collectBoundedBlock.js's own "no opening brace at all" test case. That
// fallback is correct for *its* contract, but wrong for a statement-shaped
// occurrence: it would sweep every unrelated following statement into the
// window). Parens inside string/template literals (e.g. a callback body
// logging a message containing a literal ")") are masked out via
// maskStringLiterals first, so they can't be mistaken for the statement's
// real paren structure — same bug class and fix as collectBoundedBlock's,
// see CLAUDE.md's string-literal-aware depth-counting guideline.
// Shared by two occurrence shapes: a .then() chain (a statement that may
// have its own brace-delimited callback bodies nested inside its parens)
// and a brace-less/concise-body async handler (e.g.
// `async (req, res) => res.json(x);`, no `{` anywhere) — both need "this
// one statement's own lines, not whatever collectBoundedBlock's brace-only
// contract would sweep in when the statement never opens a brace on its own
// starting line.
function collectStatement(addedLines, startIdx) {
  let depth = 0;
  let quoteState = null;
  const blockLines = [];
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const content = addedLines[i].content;
    const { masked, quoteState: nextQuoteState } = maskStringLiterals(content, quoteState);
    quoteState = nextQuoteState;
    const trimmed = masked.trim();
    // A blank or comment-only line (nothing left after masking) is never
    // itself a `.`-chain continuation, but it also doesn't end a statement
    // in real JS — a chain or a signature-then-brace statement can legally
    // have an explanatory comment or blank line sitting between two of its
    // own real lines. Only a genuinely non-blank, non-continuation line
    // signals the statement actually ended.
    if (i > startIdx && depth <= 0 && trimmed !== '' && !trimmed.startsWith('.')) break;

    blockLines.push(content);
    for (const ch of masked) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    if (depth <= 0 && trimmed !== '' && /;\s*$/.test(masked.trimEnd())) break;
  }
  return blockLines.join('\n');
}

// Finds the handler's real body-opening '{', or returns null if the handler
// is genuinely brace-less/concise-bodied (no such brace anywhere in the
// statement). A brace is only accepted as "the real one" while paren depth
// -- counted from the async signature's own opening paren, not from the
// start of the line -- is back down to <= 0, i.e. once the handler's own
// parameter list has closed. This exists because a naive per-line
// `.includes('{')` check (the prior version) is fooled by a brace that
// appears *inside* the parameter list and fully closes there, e.g. a
// default-parameter object literal: `async (req, res, opts = {}) =>` on one
// line, the real body `{` on the next. That prior check would report
// "brace-bodied" (true, correctly) from the same-line `{}`, but the caller
// then handed collectBoundedBlock the *signature's own line* as startIdx --
// and collectBoundedBlock has the identical "first '{' found, wherever it
// is" contract (correctly, for its other callers), so it too latches onto
// the default-param braces, sees them balance back to depth 0 by end of
// that same line, and returns just the one-line signature as "the block" --
// never reaching the real body (or its try/catch) on the following lines.
// Gating brace-acceptance on paren depth fixes this: the default-param `{`
// occurs while paren depth is 1 (still inside the handler's own unclosed
// parameter-list paren), so it's correctly skipped; the real body `{`
// (after the parameter list's closing `)` and the `=>`) occurs at paren
// depth 0, so it's correctly accepted. Depth is counted starting at the
// async signature's own match position (not column 0 of the line), so an
// outer wrapper call that's still open at that point -- `asyncHandler(` or
// a route-registration call like `router.get('/x', ` -- is never mistaken
// for still being inside the handler's own parameter list.
//
// This depth-gated character scan runs on *every* line from startIdx
// onward, not just the signature's own starting line: an earlier version of
// this fix only depth-gated the startIdx line and fell back to an
// unconditional "first '{' present on this line" for every later line, on
// the reasoning that "there's no parameter list left to still be inside of"
// past the signature line. That reasoning breaks when the parameter list's
// own default value spans multiple lines and contains its own nested braces
// -- e.g. `async (req, res, opts = {` / `  nested: {` / `    a: 1` / `  }` /
// `}) => {` -- because the still-open outer paren (from the signature's own
// unclosed `(`) carries across every one of those lines, but the
// unconditional per-line check accepted the *nested* object's own `{` (on
// the `nested: {` line) as if it were the handler's real body brace, purely
// because it was the first `{` character encountered after the signature
// line, with no regard for whether the parameter list's paren was still
// open. Scanning character-by-character with running paren depth on every
// line (not just the first) closes this off structurally: a `{` occurring
// anywhere is only ever accepted once the same running `depth` the
// signature-line scan already used is back down to <= 0, no matter which
// line it's on.
function findHandlerBraceStart(addedLines, startIdx) {
  const signatureMatch = ASYNC_HANDLER_SIGNATURE.exec(addedLines[startIdx].content);
  const startColumn = signatureMatch ? signatureMatch.index : 0;
  let depth = 0;
  let quoteState = null;
  for (let i = startIdx; i < addedLines.length; i += 1) {
    const rawContent = i === startIdx ? addedLines[i].content.slice(startColumn) : addedLines[i].content;
    const { masked, quoteState: nextQuoteState } = maskStringLiterals(rawContent, quoteState);
    quoteState = nextQuoteState;
    const trimmed = masked.trim();

    // Checked *before* scanning this line's own characters, using depth as
    // carried over from the end of the previous line: a brace-less handler
    // that ends via ASI (no trailing ';', e.g. `async (req, res) =>
    // res.json(x)` with no semicolon) has already implicitly ended once
    // depth returns to <= 0 on a prior line with no brace found. Scanning
    // this line's characters for '{' *before* this check (the prior
    // ordering) would search a following, unrelated line/statement for a
    // brace and could return a completely different handler's own body
    // brace as if it belonged to this one — see CLAUDE.md's per-occurrence
    // boundary-derivation guideline; this is the same class of bug as
    // collectStatement's own "check-before-scan" ordering exists to
    // prevent, applied here to brace *acceptance* instead of block
    // *collection*.
    //
    // A line whose trimmed content itself starts with '{' is exempted from
    // this bail-out: that's exactly the shape of a legitimate real body
    // brace sitting alone on its own line (e.g. after a comment between the
    // signature and the brace), and must fall through to the character
    // scan below so it can be recognized and accepted. An unrelated
    // following statement (a different handler's own signature, e.g.
    // `exports.putWidget = async (req, res) => {`) never starts with '{'
    // itself, so this exemption doesn't reopen the ASI bug above — that
    // scan is still stopped by this same check on its own non-'{'-starting
    // first line.
    if (i > startIdx && depth <= 0 && trimmed !== '' && !trimmed.startsWith('.') && !trimmed.startsWith('{')) {
      return null;
    }

    for (let c = 0; c < masked.length; c += 1) {
      const ch = masked[c];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === '{' && depth <= 0) {
        return { lineIndex: i, column: (i === startIdx ? startColumn : 0) + c };
      }
    }

    if (depth <= 0 && trimmed !== '' && /;\s*$/.test(masked.trimEnd())) return null;
  }
  return null;
}

// Text/regex-based path: derives handler and .then()-chain boundaries by
// hand-rolled brace/paren depth counting over the diff's added lines only
// (no access to the rest of the file). This is the only path available when
// the post-image file content can't be resolved (e.g. a bare diff fed via
// stdin with no repo access) or fails to parse as JS. See checkFileAst below
// for the AST-based path used when full file content is available.
function checkFileRegex(file, addedLines) {
  const issues = [];
  // Handlers are analyzed per-block (each handler's own brace-bounded
    // body), not file-wide and not "up to the next handler": a try/catch or
    // asyncHandler wrapper on one handler — or on unrelated code sitting
    // between two handlers — must not silence the check for a sibling
    // handler in the same file diff.
    const handlerIndexes = [];
    addedLines.forEach((line, idx) => {
      if (ASYNC_HANDLER_SIGNATURE.test(line.content) && HANDLER_PARAMS.test(line.content)) {
        handlerIndexes.push(idx);
      }
    });

    handlerIndexes.forEach((idx) => {
      // collectBoundedBlock is only safe to use once the handler is known to
      // actually open a brace *somewhere* in its statement: for an
      // occurrence with no '{' anywhere at all (a concise/expression-bodied
      // arrow handler, e.g. `async (req, res) => res.json(x);`),
      // collectBoundedBlock's documented fallback for that case is "read to
      // the end of input" (see its own test of the same name), which sweeps
      // every unrelated statement/handler after this one into the window and
      // can satisfy TRY_BLOCK/ASYNC_WRAPPER off content that has nothing to
      // do with this handler. A brace-less handler can never contain a
      // `try { ... }` of its own regardless (that requires braces), so it
      // only needs its own statement's lines checked for an ASYNC_WRAPPER
      // match — collectStatement bounds that correctly. findHandlerBraceStart
      // locates the handler's real body brace, not just "does '{' appear
      // anywhere on startIdx's own line" — so it's immune to a default-
      // parameter object literal (e.g. `opts = {}`) on the signature line
      // being mistaken for the body brace, and collectBoundedBlock is handed
      // a slice starting exactly at that real brace (not at idx's own line,
      // which could still have an earlier, spurious, already-balanced brace
      // pair before it that would make collectBoundedBlock stop too soon).
      const braceStart = findHandlerBraceStart(addedLines, idx);
      let block;
      if (braceStart) {
        // collectBoundedBlock is run on a slice starting exactly at the
        // real brace (so its own depth-counting can't latch onto an earlier
        // spurious, already-balanced pair, e.g. a default-parameter object
        // literal) purely to find how many lines the body spans. The actual
        // text handed to the TRY_BLOCK/ASYNC_WRAPPER check below is then
        // re-assembled from the *original, unsliced* lines over that same
        // span — an ASYNC_WRAPPER match like `asyncHandler(` legitimately
        // sits *before* the body brace, on the signature line's own prefix,
        // which the slice deliberately cut off and must not lose.
        const sliced = addedLines.slice(braceStart.lineIndex);
        sliced[0] = { ...sliced[0], content: sliced[0].content.slice(braceStart.column) };
        const lineCount = collectBoundedBlock(sliced, 0).split('\n').length;
        block = addedLines
          .slice(braceStart.lineIndex, braceStart.lineIndex + lineCount)
          .map((l) => l.content)
          .join('\n');
      } else {
        block = collectStatement(addedLines, idx);
      }
      // Tested against the string/comment-masked block, not the raw one --
      // a comment merely mentioning "try {" or "asyncHandler" (e.g. a TODO)
      // must not be mistaken for a real one and silence a genuine finding.
      // See CLAUDE.md's string-literal-aware depth-counting guideline; the
      // same masking that protects brace-depth counting from a stray
      // string/comment character must also protect a keyword-presence
      // check from a stray string/comment *word*.
      const maskedBlock = maskStringLiterals(block).masked;
      if (!TRY_BLOCK.test(maskedBlock) && !ASYNC_WRAPPER.test(maskedBlock)) {
        const line = addedLines[idx];
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'high',
          message: `Async route handler added without a try/catch or an asyncHandler wrapper: "${line.content.trim()}"`,
          fix: 'Wrap the handler body in try/catch (or wrap the handler itself with an asyncHandler utility) and forward errors to a catch-all error middleware.',
        });
      }
    });

    // Likewise, each .then() call is checked against its own statement —
    // not "does a .catch() appear anywhere in the file diff" (a caught
    // chain elsewhere must not silence an uncaught one), and not a fixed
    // N-line window either: a window that's too small misses a .catch()
    // that's genuinely part of the same chain a few lines down (false
    // positive on a real multi-line-formatted chain), while a window
    // that's too large can pull in an unrelated statement's .catch() and
    // silence a genuinely uncaught chain right next to it (false
    // negative). collectStatement walks forward tracking paren depth
    // and stops at the statement's actual end (a balanced, semicolon-
    // terminated line, or the first following line that isn't a `.`
    // chain continuation), so the window always matches the real
    // boundary of the one chain being checked.
    addedLines.forEach((line, idx) => {
      if (!THEN_CALL.test(line.content)) return;
      const window = collectStatement(addedLines, idx);
      const maskedWindow = maskStringLiterals(window).masked;
      if (!CATCH_CALL.test(maskedWindow)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'medium',
          message: 'Promise chain uses .then() without a matching .catch() in this diff.',
          fix: 'Add a .catch() handler (or use try/catch with await) so a rejected promise cannot go unhandled.',
        });
      }
    });
  return issues;
}

// AST-based path: parses the resolved post-image file content once and maps
// each diff-added line onto real AST nodes, so handler and .then()-chain
// boundaries come from the actual parse tree instead of hand-rolled
// brace/paren counting. This sidesteps the whole recurring bug class in
// checkFileRegex above (default-parameter braces, ASI, ASI-adjacent
// handlers, ...) structurally: a real parser already knows where a function
// or a statement ends. Only used when file.content is resolvable and parses
// as valid JS; see `check` below for the fallback.
function isRouteHandlerParams(params) {
  return (
    params.length >= 2 &&
    params[0].type === 'Identifier' &&
    params[0].name === 'req' &&
    params[1].type === 'Identifier' &&
    params[1].name === 'res'
  );
}

function isWrappedByAsyncHandler(ancestors) {
  const parent = ancestors[ancestors.length - 2];
  return (
    !!parent &&
    parent.type === 'CallExpression' &&
    parent.callee.type === 'Identifier' &&
    parent.callee.name === 'asyncHandler'
  );
}

// Searches the handler body's own subtree for a try/catch, at any nesting
// depth of blocks/statements, but never descending into a nested function
// defined within the handler -- that inner function's own try/catch belongs
// to its own execution, not the outer handler's (see subtreeInOwnScope).
function subtreeHasTryStatement(node) {
  return subtreeInOwnScope(node, (n) => n.type === 'TryStatement');
}

function isCatchCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'catch'
  );
}

// Same own-function-scope restriction as subtreeHasTryStatement: a .catch()
// call sitting inside a nested callback's own body (as opposed to chained
// directly onto the statement's own promise expression) belongs to that
// nested callback's own chain, not the outer .then() being checked.
function subtreeHasCatchCall(node) {
  return subtreeInOwnScope(node, isCatchCall);
}

// Finds the nearest enclosing statement (not a bare BlockStatement, which
// can hold several sibling statements) so a .then() call is judged against
// the one statement/chain it's actually part of, not the whole containing
// block.
function findEnclosingStatement(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const node = ancestors[i];
    if (node.type !== 'BlockStatement' && /(Statement|Declaration)$/.test(node.type)) {
      return node;
    }
  }
  return ancestors[0];
}

function checkFileAst(file, addedLines) {
  const addedLineNumbers = new Set(addedLines.map((l) => l.newLine));
  const lineContent = new Map(addedLines.map((l) => [l.newLine, l.content]));
  const ast = parseAst(file.content);
  const issues = [];

  function handleHandlerCandidate(node, state, ancestors) {
    if (!node.async || !isRouteHandlerParams(node.params)) return;
    const line = node.loc.start.line;
    if (!addedLineNumbers.has(line)) return;
    if (isWrappedByAsyncHandler(ancestors) || subtreeHasTryStatement(node.body)) return;
    issues.push({
      file: file.file,
      line,
      severity: 'high',
      message: `Async route handler added without a try/catch or an asyncHandler wrapper: "${(lineContent.get(line) || '').trim()}"`,
      fix: 'Wrap the handler body in try/catch (or wrap the handler itself with an asyncHandler utility) and forward errors to a catch-all error middleware.',
    });
  }

  walk.ancestor(ast, {
    ArrowFunctionExpression: handleHandlerCandidate,
    FunctionExpression: handleHandlerCandidate,
    FunctionDeclaration: handleHandlerCandidate,
  });

  const reportedThenLines = new Set();
  walk.ancestor(ast, {
    CallExpression(node, state, ancestors) {
      if (node.callee.type !== 'MemberExpression' || node.callee.computed) return;
      if (node.callee.property.type !== 'Identifier' || node.callee.property.name !== 'then') return;
      const line = memberCallLine(node);
      if (!addedLineNumbers.has(line) || reportedThenLines.has(line)) return;
      const statement = findEnclosingStatement(ancestors);
      if (subtreeHasCatchCall(statement)) return;
      reportedThenLines.add(line);
      issues.push({
        file: file.file,
        line,
        severity: 'medium',
        message: 'Promise chain uses .then() without a matching .catch() in this diff.',
        fix: 'Add a .catch() handler (or use try/catch with await) so a rejected promise cannot go unhandled.',
      });
    },
  });

  return issues;
}

function check(files) {
  const issues = [];
  for (const file of files) {
    const addedLines = collectAddedLines(file);
    // AST path only attempted when the caller resolved full post-image
    // content (see reviewer.js's optional git-show resolution); falls back
    // to the regex path below on any parse failure (e.g. a diff fragment
    // reconstructed for testing that isn't valid standalone JS, or a
    // genuine syntax error) so a resolvable-but-broken file never drops
    // findings entirely.
    if (typeof file.content === 'string') {
      try {
        issues.push(...checkFileAst(file, addedLines));
        continue;
      } catch (err) {
        // fall through to the regex path
      }
    }
    issues.push(...checkFileRegex(file, addedLines));
  }
  return issues;
}

module.exports = { category: 'error-handling', check };
