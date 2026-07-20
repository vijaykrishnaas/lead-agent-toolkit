const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const performanceRule = require('../../src/rules/performance');
const { reconstructFileContent } = require('../helpers/reconstructFileContent');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

// See errorHandling.test.js's bothPaths for the rationale: every case here
// runs against both the diff-only parse (regex/text-boundary fallback) and
// the same files with reconstructed post-image content attached (AST path,
// or the fallback again for the handful of fixtures whose reconstructed
// text isn't valid standalone JS on its own).
function bothPaths(diffText) {
  const files = parseDiff(diffText);
  return [files, reconstructFileContent(files)];
}

describe('performance rule', () => {
  it('flags await used inside a .forEach() callback', () => {
    for (const files of bothPaths(loadFixture('performance-await-in-foreach.diff'))) {
      const issues = performanceRule.check(files);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        file: 'src/services/notifyService.js',
        severity: 'medium',
      });
      expect(issues[0].message).toMatch(/forEach/);
    }
  });

  it('flags the JSON.parse(JSON.stringify(...)) deep-clone anti-pattern', () => {
    const diff = [
      'diff --git a/src/utils/clone.js b/src/utils/clone.js',
      '--- a/src/utils/clone.js',
      '+++ b/src/utils/clone.js',
      '@@ -1,1 +1,2 @@',
      ' function clone(obj) {',
      '+  return JSON.parse(JSON.stringify(obj));',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('low');
    }
  });

  it('returns no issues for a clean diff', () => {
    for (const files of bothPaths(loadFixture('clean.diff'))) {
      expect(performanceRule.check(files)).toEqual([]);
    }
  });

  it('does not flag a clean forEach just because an unrelated await appears later in the same file', () => {
    const diff = [
      'diff --git a/src/services/batch.js b/src/services/batch.js',
      '--- a/src/services/batch.js',
      '+++ b/src/services/batch.js',
      '@@ -1,1 +1,8 @@',
      '+items.forEach((item) => {',
      '+  doSomething(item);',
      '+});',
      '+',
      '+setTimeout(async () => {',
      '+  await doOther();',
      '+});',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toEqual([]);
    }
  });

  it('flags await inside a .forEach() whose callback has a destructuring default containing a nested call', () => {
    // Regression: FOREACH_START used `[^)]*` for the param list, which can't
    // contain a nested `)` -- a default/destructuring param like
    // `({ id = genId() })` broke the match entirely, so the whole block
    // (including a genuine await) was never even inspected.
    const diff = [
      'diff --git a/src/services/batch.js b/src/services/batch.js',
      '--- a/src/services/batch.js',
      '+++ b/src/services/batch.js',
      '@@ -1,1 +1,4 @@',
      '+items.forEach(({ id = genId() }) => {',
      '+  await save(id);',
      '+});',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toHaveLength(1);
      expect(issues[0].line).toBe(1);
    }
  });

  it('does not let a clean forEach silence — or misattribute the line of — a later bad forEach in the same file', () => {
    const diff = [
      'diff --git a/src/services/batch.js b/src/services/batch.js',
      '--- a/src/services/batch.js',
      '+++ b/src/services/batch.js',
      '@@ -1,1 +1,7 @@',
      '+items.forEach((item) => {',
      '+  doSomething(item);',
      '+});',
      '+',
      '+users.forEach(async (user) => {',
      '+  await mailer.send(user.email);',
      '+});',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toHaveLength(1);
      expect(issues[0].line).toBe(5);
    }
  });

  it('flags await inside a .forEach() whose callback body contains a closing brace inside a string literal', () => {
    // Regression: collectBoundedBlock (shared with errorHandling.js) counted
    // every '{' / '}' character including ones inside string literals, so a
    // stray '}' in a log message before the real await over-extended the
    // window's brace-depth count and hid the genuine await-in-forEach.
    const diff = [
      'diff --git a/src/services/batch.js b/src/services/batch.js',
      '--- a/src/services/batch.js',
      '+++ b/src/services/batch.js',
      '@@ -1,1 +1,4 @@',
      '+items.forEach(async (item) => {',
      '+  log("unexpected } here");',
      '+  await save(item);',
      '+});',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toHaveLength(1);
      expect(issues[0].line).toBe(1);
    }
  });

  it('does not flag a JSON.parse(JSON.stringify(...)) mention that only appears inside a comment', () => {
    // Regression: DEEP_CLONE_ANTIPATTERN was tested against the raw line
    // content, so a comment merely mentioning the pattern (e.g. explaining
    // why to avoid it) was flagged as if it were real code.
    const diff = [
      'diff --git a/src/utils/clone.js b/src/utils/clone.js',
      '--- a/src/utils/clone.js',
      '+++ b/src/utils/clone.js',
      '@@ -1,1 +1,2 @@',
      ' function clone(obj) {',
      '+  // avoid JSON.parse(JSON.stringify(obj)) here, use structuredClone',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toEqual([]);
    }
  });

  it('does not flag a .forEach() mention that only appears inside a comment, even when real unrelated code nearby contains a real await', () => {
    // Regression: FOREACH_START was tested against the raw line content, so
    // a comment merely mentioning forEach syntax (e.g. describing old code)
    // was treated as a real forEach start. collectBoundedBlock then walked
    // into the following genuinely async code and found its unrelated
    // await, misattributing it to the fake forEach at the comment's line.
    const diff = [
      'diff --git a/src/jobs/runner.js b/src/jobs/runner.js',
      '--- a/src/jobs/runner.js',
      '+++ b/src/jobs/runner.js',
      '@@ -1,1 +1,4 @@',
      '+// old code used items.forEach((item) => {',
      '+async function handler() {',
      '+  await doSomething();',
      '+}',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toEqual([]);
    }
  });

  it('does not flag a clean forEach just because a comment inside it mentions "await"', () => {
    // Regression: AWAIT_PATTERN was tested against the raw, unmasked block
    // text (shared collectBoundedBlock, same as errorHandling.js's
    // TRY_BLOCK/ASYNC_WRAPPER check), so a comment merely mentioning
    // "await" (e.g. "do not await here") produced a false positive against
    // a forEach callback with no real await at all.
    const diff = [
      'diff --git a/src/jobs/runner.js b/src/jobs/runner.js',
      '--- a/src/jobs/runner.js',
      '+++ b/src/jobs/runner.js',
      '@@ -1,1 +1,4 @@',
      ' const items = require("./items");',
      '+items.forEach((item) => {',
      '+  // do not await here, keep this synchronous',
      '+  processSync(item);',
      '+});',
    ].join('\n');

    for (const files of bothPaths(diff)) {
      const issues = performanceRule.check(files);
      expect(issues).toEqual([]);
    }
  });
});

describe('performance rule (AST path, direct)', () => {
  // See errorHandling.test.js's equivalent block: these use hand-written,
  // syntactically complete file content so the AST path is definitely what
  // ran, rather than incidentally falling back on an incomplete snippet.
  function withContent(diffText, content) {
    const files = parseDiff(diffText);
    files.forEach((file) => { file.content = content; });
    return files;
  }

  it('flags await inside a .forEach() via the AST path on a syntactically complete file', () => {
    const content = [
      'const mailer = require("../lib/mailer");',
      'async function notifyAll(users) {',
      '  users.forEach(async (user) => {',
      '    await mailer.send(user.email);',
      '  });',
      '}',
      'module.exports = { notifyAll };',
    ].join('\n');
    const diff = [
      'diff --git a/src/services/notifyService.js b/src/services/notifyService.js',
      '--- a/src/services/notifyService.js',
      '+++ b/src/services/notifyService.js',
      '@@ -1,1 +1,6 @@',
      ' const mailer = require("../lib/mailer");',
      '+async function notifyAll(users) {',
      '+  users.forEach(async (user) => {',
      '+    await mailer.send(user.email);',
      '+  });',
      '+}',
      '+module.exports = { notifyAll };',
    ].join('\n');

    const issues = performanceRule.check(withContent(diff, content));
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });

  it('flags the JSON.parse(JSON.stringify(...)) deep-clone anti-pattern via the AST path', () => {
    const content = [
      'function clone(obj) {',
      '  return JSON.parse(JSON.stringify(obj));',
      '}',
    ].join('\n');
    const diff = [
      'diff --git a/src/utils/clone.js b/src/utils/clone.js',
      '--- a/src/utils/clone.js',
      '+++ b/src/utils/clone.js',
      '@@ -1,1 +1,3 @@',
      ' function clone(obj) {',
      '+  return JSON.parse(JSON.stringify(obj));',
      '+}',
    ].join('\n');

    const issues = performanceRule.check(withContent(diff, content));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('low');
  });

  it('falls back to the regex path when the resolved content fails to parse', () => {
    const diff = [
      'diff --git a/src/utils/clone.js b/src/utils/clone.js',
      '--- a/src/utils/clone.js',
      '+++ b/src/utils/clone.js',
      '@@ -1,1 +1,2 @@',
      ' function clone(obj) {',
      '+  return JSON.parse(JSON.stringify(obj));',
    ].join('\n');

    const issues = performanceRule.check(withContent(diff, 'this is not { valid JS ('));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('low');
  });

  it('does not flag a .forEach() callback whose own body never awaits, even when it defines a nested async helper that does', () => {
    // Regression: subtreeHasAwait used to walk the callback body's *entire*
    // subtree, including any function declared and called within it, so an
    // inner helper's own await got blamed on the outer .forEach() callback
    // even though the callback itself never awaits anything and its
    // iterations still run concurrently/unordered exactly as normal. See
    // CLAUDE.md guideline 2 / subtreeInOwnScope.js.
    const content = [
      'const items = [];',
      'items.forEach((item) => {',
      '  const inner = async () => { await doSomething(item); };',
      '  inner();',
      '});',
    ].join('\n');
    const diff = [
      'diff --git a/src/utils/batch.js b/src/utils/batch.js',
      '--- a/src/utils/batch.js',
      '+++ b/src/utils/batch.js',
      '@@ -1,1 +1,5 @@',
      ' const items = [];',
      '+items.forEach((item) => {',
      '+  const inner = async () => { await doSomething(item); };',
      '+  inner();',
      '+});',
    ].join('\n');

    const issues = performanceRule.check(withContent(diff, content));
    expect(issues.some((i) => /await used inside a \.forEach\(\)/i.test(i.message))).toBe(false);
  });

  it('flags await inside a .forEach() appended as a chain continuation onto an already-existing base statement', () => {
    // Regression: same bug class as errorHandling.test.js's equivalent
    // .then() case. The forEach CallExpression walk used
    // `node.loc.start.line`, which for a multi-line member chain
    // (`items\n  .forEach(...)`) is the *base object's* line, not the line
    // `.forEach(` itself sits on. When the base statement already existed
    // and only the `.forEach()` continuation was newly added, the base
    // object's line was absent from `addedLineNumbers`, silently dropping a
    // genuine, newly-added await-in-forEach finding. See memberCallLine.js.
    const content = [
      'async function run(items) {',
      '  items',
      '    .forEach(async (item) => {',
      '      await save(item);',
      '    });',
      '}',
    ].join('\n');
    const diff = [
      'diff --git a/src/jobs/run.js b/src/jobs/run.js',
      '--- a/src/jobs/run.js',
      '+++ b/src/jobs/run.js',
      '@@ -1,2 +1,5 @@',
      ' async function run(items) {',
      '   items',
      '+    .forEach(async (item) => {',
      '+      await save(item);',
      '+    });',
      ' }',
    ].join('\n');

    const issues = performanceRule.check(withContent(diff, content));
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });

  it('flags a JSON.parse(JSON.stringify(...)) call whose .parse( is on its own line, appended onto an already-existing JSON identifier line', () => {
    // Same bug class, applied to the deep-clone AST check's outer
    // `JSON.parse(...)` CallExpression.
    const content = [
      'function clone(obj) {',
      '  return JSON',
      '    .parse(JSON.stringify(obj));',
      '}',
    ].join('\n');
    const diff = [
      'diff --git a/src/utils/clone.js b/src/utils/clone.js',
      '--- a/src/utils/clone.js',
      '+++ b/src/utils/clone.js',
      '@@ -1,2 +1,3 @@',
      ' function clone(obj) {',
      '   return JSON',
      '+    .parse(JSON.stringify(obj));',
      ' }',
    ].join('\n');

    const issues = performanceRule.check(withContent(diff, content));
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });
});
