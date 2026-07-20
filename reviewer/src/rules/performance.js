const walk = require('acorn-walk');
const { collectAddedLines } = require('../utils/collectAddedLines');
const { collectBoundedBlock } = require('../utils/collectBoundedBlock');
const { maskStringLiterals } = require('../utils/maskStringLiterals');
const { memberCallLine } = require('../utils/memberCallLine');
const { parseAst } = require('../utils/parseAst');
const { subtreeInOwnScope } = require('../utils/subtreeInOwnScope');

// The param-list group is matched lazily (not `[^)]*`) so a nested paren in
// a default value or destructuring default (e.g. `({ id = genId() }) => {`)
// doesn't stop the match at that inner `)` -- the lazy quantifier keeps
// expanding until it finds a `)` immediately followed by `=> {`, which is
// necessarily the callback's own closing paren.
const FOREACH_START = /\.forEach\(\s*(async\s+)?\(.*?\)\s*=>\s*{/;
const AWAIT_PATTERN = /\bawait\b/;
const DEEP_CLONE_ANTIPATTERN = /JSON\.parse\(\s*JSON\.stringify\(/;

// Text/regex-based path: derives .forEach() callback boundaries by
// hand-rolled brace/paren depth counting over the diff's added lines only.
// This is the fallback used when the post-image file content can't be
// resolved or fails to parse as JS; see checkFileAst below for the
// AST-based path used when full file content is available.
function checkFileRegex(file, addedLines) {
  const issues = [];
  {
    // Scoped per .forEach() call: an await inside one forEach block — or
    // anywhere else in the file diff — must not be attributed to, or
    // silence the check for, a different forEach block in the same file.
    addedLines.forEach((line, idx) => {
      // Tested against the comment/string-masked line, not the raw one --
      // a comment merely mentioning forEach syntax (e.g. describing old
      // code) must not be mistaken for a real forEach start and go on to
      // misattribute an unrelated await from the following code to it.
      const maskedLine = maskStringLiterals(line.content).masked;
      if (!FOREACH_START.test(maskedLine)) return;
      const block = collectBoundedBlock(addedLines, idx);
      // Tested against the string/comment-masked block, not the raw one --
      // a comment merely mentioning "await" (e.g. "// do not await here")
      // must not be mistaken for a real one and produce a false positive.
      // Same bug class and fix as errorHandling.js's TRY_BLOCK/ASYNC_WRAPPER
      // check, and the same reasoning as CLAUDE.md's string-literal-aware
      // depth-counting guideline, applied to a keyword-presence check
      // instead of a depth count.
      const maskedBlock = maskStringLiterals(block).masked;
      if (AWAIT_PATTERN.test(maskedBlock)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'medium',
          message: 'await used inside a .forEach() callback; the awaits run concurrently and unordered, not sequentially.',
          fix: 'Use a for...of loop (for sequential awaits) or Promise.all(items.map(...)) (for concurrent awaits) instead of .forEach().',
        });
      }
    });

    for (const line of addedLines) {
      // Same reasoning as the FOREACH_START check above -- a comment
      // merely mentioning the anti-pattern must not be flagged as if it
      // were real code.
      if (DEEP_CLONE_ANTIPATTERN.test(maskStringLiterals(line.content).masked)) {
        issues.push({
          file: file.file,
          line: line.newLine,
          severity: 'low',
          message: `JSON.parse(JSON.stringify(...)) deep-clone anti-pattern: "${line.content.trim()}"`,
          fix: 'Use structuredClone(value) (Node 20+) or a dedicated cloning utility instead of the JSON round-trip.',
        });
      }
    }
  }
  return issues;
}

// AST-based path: parses the resolved post-image file content once and maps
// each diff-added line onto real AST nodes, so a .forEach() callback's own
// body is found from the parse tree instead of hand-rolled brace counting.
// Only used when file.content is resolvable and parses as valid JS; see
// `check` below for the fallback.
// Own-function-scope only: an await inside a nested function defined within
// the .forEach() callback (e.g. a helper the callback declares but doesn't
// itself await) belongs to that inner function's own execution, not the
// callback's -- it doesn't make the callback's own iterations run
// out-of-order. See subtreeInOwnScope.
function subtreeHasAwait(node) {
  return subtreeInOwnScope(node, (n) => n.type === 'AwaitExpression');
}

function isMemberCall(node, objectName, propertyName) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === propertyName &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === objectName
  );
}

function checkFileAst(file, addedLines) {
  const addedLineNumbers = new Set(addedLines.map((l) => l.newLine));
  const lineContent = new Map(addedLines.map((l) => [l.newLine, l.content]));
  const ast = parseAst(file.content);
  const issues = [];

  walk.simple(ast, {
    CallExpression(node) {
      if (
        node.callee.type !== 'MemberExpression' ||
        node.callee.computed ||
        node.callee.property.type !== 'Identifier' ||
        node.callee.property.name !== 'forEach'
      ) {
        return;
      }
      const callback = node.arguments[0];
      if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')) {
        return;
      }
      const line = memberCallLine(node);
      if (!addedLineNumbers.has(line)) return;
      if (!subtreeHasAwait(callback.body)) return;
      issues.push({
        file: file.file,
        line,
        severity: 'medium',
        message: 'await used inside a .forEach() callback; the awaits run concurrently and unordered, not sequentially.',
        fix: 'Use a for...of loop (for sequential awaits) or Promise.all(items.map(...)) (for concurrent awaits) instead of .forEach().',
      });
    },
  });

  walk.simple(ast, {
    CallExpression(node) {
      if (!isMemberCall(node, 'JSON', 'parse')) return;
      const arg = node.arguments[0];
      if (!arg || !isMemberCall(arg, 'JSON', 'stringify')) return;
      const line = memberCallLine(node);
      if (!addedLineNumbers.has(line)) return;
      issues.push({
        file: file.file,
        line,
        severity: 'low',
        message: `JSON.parse(JSON.stringify(...)) deep-clone anti-pattern: "${(lineContent.get(line) || '').trim()}"`,
        fix: 'Use structuredClone(value) (Node 20+) or a dedicated cloning utility instead of the JSON round-trip.',
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
    // content; falls back to the regex path on any parse failure so a
    // resolvable-but-unparsable file never drops findings entirely.
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

module.exports = { category: 'performance', check };
