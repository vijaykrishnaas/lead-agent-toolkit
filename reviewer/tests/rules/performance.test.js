const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const performanceRule = require('../../src/rules/performance');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('performance rule', () => {
  it('flags await used inside a .forEach() callback', () => {
    const files = parseDiff(loadFixture('performance-await-in-foreach.diff'));
    const issues = performanceRule.check(files);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'src/services/notifyService.js',
      severity: 'medium',
    });
    expect(issues[0].message).toMatch(/forEach/);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('low');
  });

  it('returns no issues for a clean diff', () => {
    const files = parseDiff(loadFixture('clean.diff'));
    expect(performanceRule.check(files)).toEqual([]);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toEqual([]);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(5);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toEqual([]);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toEqual([]);
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

    const issues = performanceRule.check(parseDiff(diff));
    expect(issues).toEqual([]);
  });
});
