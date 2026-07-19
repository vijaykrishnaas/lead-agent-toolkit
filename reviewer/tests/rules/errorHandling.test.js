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

  it('flags both handlers when unrelated code with its own try/catch sits between them', () => {
    // Regression: handler blocks used to be bounded by "up to the next
    // handler's start line," which swept unrelated intervening code (e.g. a
    // helper function with its own try/catch) into the first handler's
    // window, satisfying TRY_BLOCK for a handler that has no error handling
    // of its own.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,16 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => {',
      '+  res.json(await Widget.findById(req.params.id));',
      '+};',
      '+function unrelatedHelper() {',
      '+  try {',
      '+    doSomething();',
      '+  } catch (e) {',
      '+    log(e);',
      '+  }',
      '+}',
      '+exports.deleteWidget = async (req, res) => {',
      '+  await Widget.findByIdAndDelete(req.params.id);',
      '+  res.status(204).send();',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(2);
    expect(handlerIssues.some((i) => i.message.includes('getWidget'))).toBe(true);
    expect(handlerIssues.some((i) => i.message.includes('deleteWidget'))).toBe(true);
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

  it('does not flag a caught chain whose callback body contains a closing paren inside a string literal', () => {
    // Regression: collectThenStatement counted every '(' / ')' character
    // including ones inside string literals, so a callback body logging a
    // message containing a literal ")" prematurely closed the paren-depth
    // count and truncated the scan before the chain's real .catch().
    const diff = [
      'diff --git a/src/jobs/cleanup.js b/src/jobs/cleanup.js',
      '--- a/src/jobs/cleanup.js',
      '+++ b/src/jobs/cleanup.js',
      '@@ -1,1 +1,5 @@',
      ' function cleanup() {',
      '+  promise.then((result) => {',
      '+    console.log("looks like this: )");',
      '+    return result;',
      '+  }).catch((err) => log(err));',
      '+}',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message))).toBe(false);
  });

  it('flags a brace-less/concise-body async handler with no try/catch, without sweeping in a later handler\'s try/catch', () => {
    // Regression: collectBoundedBlock only starts tracking depth once it
    // sees a '{'. A concise-body arrow handler (e.g.
    // `async (req, res) => res.json(x);`) has no '{' anywhere on its own
    // line, so `opened` never became true there and the old code fell
    // through to collectBoundedBlock's "no opening brace at all" fallback,
    // which reads all the way to the end of input -- sweeping the *next*
    // handler's own try/catch into this handler's window and silencing a
    // genuinely unguarded handler.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,9 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => res.json(await Widget.findById(req.params.id));',
      '+exports.createWidget = async (req, res) => {',
      '+  try {',
      '+    const widget = await Widget.create(req.body);',
      '+    res.status(201).json(widget);',
      '+  } catch (err) {',
      '+    res.status(500).json({ error: "failed" });',
      '+  }',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('getWidget');
  });

  it('does not flag a brace-less/concise-body async handler that is wrapped inline by an asyncHandler utility', () => {
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,2 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = asyncHandler(async (req, res) => res.json(await Widget.findById(req.params.id)));',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /async route handler/i.test(i.message))).toBe(false);
  });

  it('flags an async handler with no try/catch even when the block contains a string literal with a stray "{"', () => {
    // Regression: collectBoundedBlock counted every '{' / '}' character
    // including ones inside string literals, so a stray '{' in a handler's
    // own body over-extended its window into unrelated following code and
    // silenced a genuine finding for the handler itself.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,7 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => {',
      '+  res.json({ note: "unexpected {" });',
      '+};',
      '+function unrelatedHelper() {',
      '+  try {',
      '+    doSomething();',
      '+  } catch (e) {',
      '+    log(e);',
      '+  }',
      '+}',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('getWidget');
  });
});
