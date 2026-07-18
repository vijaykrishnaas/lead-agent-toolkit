const { collectAddedLines } = require('../utils/collectAddedLines');

// The param-list group is matched lazily (not `[^)]*`) so a nested paren in
// a default value or destructuring default (e.g. `({ id = genId() }) => {`)
// doesn't stop the match at that inner `)` -- the lazy quantifier keeps
// expanding until it finds a `)` immediately followed by `=> {`, which is
// necessarily the callback's own closing paren.
const FOREACH_START = /\.forEach\(\s*(async\s+)?\(.*?\)\s*=>\s*{/;
const AWAIT_PATTERN = /\bawait\b/;
const DEEP_CLONE_ANTIPATTERN = /JSON\.parse\(\s*JSON\.stringify\(/;

// Collects the lines belonging to a single .forEach(...) callback body
// (from its opening "{" up to the matching "}", tracked by brace depth) so
// that an await inside one forEach — or unrelated code after it — can't be
// mistaken for content of a different, unrelated block.
function collectForEachBlock(addedLines, startIdx) {
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

function check(files) {
  const issues = [];
  for (const file of files) {
    const addedLines = collectAddedLines(file);

    // Scoped per .forEach() call: an await inside one forEach block — or
    // anywhere else in the file diff — must not be attributed to, or
    // silence the check for, a different forEach block in the same file.
    addedLines.forEach((line, idx) => {
      if (!FOREACH_START.test(line.content)) return;
      const block = collectForEachBlock(addedLines, idx);
      if (AWAIT_PATTERN.test(block)) {
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
      if (DEEP_CLONE_ANTIPATTERN.test(line.content)) {
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

module.exports = { category: 'performance', check };
