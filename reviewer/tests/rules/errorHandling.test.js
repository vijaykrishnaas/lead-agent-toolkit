const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const errorHandlingRule = require('../../src/rules/errorHandling');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('error-handling rule', () => {
  it('flags an async route handler with no try/catch and no asyncHandler wrapper', () => {
    const files = parseDiff(loadFixture('error-handling-no-catch.diff'));
    const issues = errorHandlingRule.check(files);

    const handlerIssue = issues.find((i) => /async route handler/i.test(i.message));
    expect(handlerIssue).toBeDefined();
    expect(handlerIssue.severity).toBe('high');
    expect(handlerIssue.file).toBe('src/controllers/widgetsController.js');
  });

  it('does not flag an async handler that is wrapped in try/catch', () => {
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,7 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => {',
      '+  try {',
      '+    const widget = await Widget.findById(req.params.id);',
      '+    res.json(widget);',
      '+  } catch (err) {',
      '+    res.status(500).json({ error: "failed" });',
      '+  }',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /async route handler/i.test(i.message))).toBe(false);
  });

  it('does not flag an async handler wrapped by an asyncHandler utility', () => {
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,4 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = asyncHandler(async (req, res) => {',
      '+  res.json(await Widget.findById(req.params.id));',
      '+});',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /async route handler/i.test(i.message))).toBe(false);
  });

  it('flags the second handler when only the first of two handlers in a file has a try/catch', () => {
    // Regression: the rule used to decide hasTry/hasAsyncWrapper once for
    // the whole file diff, so a try/catch on one handler silenced the
    // check for every other handler added in the same file.
    const files = parseDiff(loadFixture('error-handling-mixed-handlers.diff'));
    const issues = errorHandlingRule.check(files);

    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('deleteWidget');
  });

  it('flags an uncaught .then() chain even when an earlier chain in the same file has a .catch()', () => {
    const diff = [
      'diff --git a/src/jobs/cleanup.js b/src/jobs/cleanup.js',
      '--- a/src/jobs/cleanup.js',
      '+++ b/src/jobs/cleanup.js',
      '@@ -1,1 +1,5 @@',
      ' function cleanup() {',
      '+  db.remove().then((r) => r.count).catch((e) => log(e));',
      '+}',
      '+function purge() {',
      '+  return db.purge().then((r) => r.count);',
      '+}',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const thenIssues = issues.filter((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message));
    expect(thenIssues).toHaveLength(1);
    expect(thenIssues[0].line).toBe(5);
  });

  it('flags a .then() chain with no matching .catch()', () => {
    const diff = [
      'diff --git a/src/jobs/cleanup.js b/src/jobs/cleanup.js',
      '--- a/src/jobs/cleanup.js',
      '+++ b/src/jobs/cleanup.js',
      '@@ -1,1 +1,2 @@',
      ' function cleanup() {',
      '+  return db.remove().then((result) => result.count);',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message))).toBe(true);
  });

  it('does not flag a caught chain whose .catch() falls outside a fixed small line window (multi-line-formatted chain)', () => {
    // Regression: the .then()/.catch() check used to slice a fixed 3-line
    // window after each .then(), so a legitimately-caught chain spread
    // across more than 3 lines (e.g. one .then() per line) had its real
    // .catch() fall outside the window and got flagged as uncaught.
    const diff = [
      'diff --git a/src/jobs/cleanup.js b/src/jobs/cleanup.js',
      '--- a/src/jobs/cleanup.js',
      '+++ b/src/jobs/cleanup.js',
      '@@ -1,1 +1,7 @@',
      ' function cleanup() {',
      '+  return promise',
      '+    .then(a)',
      '+    .then(b)',
      '+    .then(c)',
      '+    .catch(handleErr);',
      '+}',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message))).toBe(false);
  });

  it('flags an uncaught .then() even when an unrelated adjacent statement has its own .catch() one line later', () => {
    // Regression: the same fixed 3-line window could pull an unrelated,
    // independent statement's .catch() into the window, silencing a
    // genuinely uncaught chain right next to it.
    const diff = [
      'diff --git a/src/jobs/cleanup.js b/src/jobs/cleanup.js',
      '--- a/src/jobs/cleanup.js',
      '+++ b/src/jobs/cleanup.js',
      '@@ -1,1 +1,4 @@',
      ' function cleanup() {',
      '+  jobA.then(doA);',
      '+  jobB.then(doB).catch(handleB);',
      '+}',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const thenIssues = issues.filter((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message));
    expect(thenIssues).toHaveLength(1);
    expect(thenIssues[0].line).toBe(2);
  });
});
