const { collectAddedLines } = require('../utils/collectAddedLines');

const AWAIT_IN_FOREACH = /\.forEach\(\s*(async\s+)?\([^)]*\)\s*=>\s*{[\s\S]*?await[\s\S]*?}\s*\)/;
const DEEP_CLONE_ANTIPATTERN = /JSON\.parse\(\s*JSON\.stringify\(/;

function check(files) {
  const issues = [];
  for (const file of files) {
    const addedLines = collectAddedLines(file);
    const combinedAdded = addedLines.map((line) => line.content).join('\n');

    if (AWAIT_IN_FOREACH.test(combinedAdded)) {
      const forEachLine = addedLines.find((line) => /\.forEach\(/.test(line.content));
      issues.push({
        file: file.file,
        line: forEachLine.newLine,
        severity: 'medium',
        message: 'await used inside a .forEach() callback; the awaits run concurrently and unordered, not sequentially.',
        fix: 'Use a for...of loop (for sequential awaits) or Promise.all(items.map(...)) (for concurrent awaits) instead of .forEach().',
      });
    }

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
