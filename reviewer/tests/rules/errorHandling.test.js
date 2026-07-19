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

  it('does not flag a try/catch-wrapped handler whose opening brace is on the line after the signature', () => {
    // Regression: the prior fix for brace-less/concise-body handlers decided
    // block-bodied-vs-brace-less by checking only the handler's own
    // signature line for '{'. A block-bodied arrow handler can legally put
    // its '{' on the next line instead (`async (req, res) =>` then `{` on
    // its own line), which that check misclassified as brace-less --
    // routing it to collectStatement, whose break condition fires the
    // instant it sees the bare '{' line (not a `.`-continuation, depth
    // already back to 0), well before ever reaching the try/catch inside
    // the block. A fully try/catch-wrapped handler was misflagged as
    // missing error handling as a result.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,8 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) =>',
      '+{',
      '+  try {',
      '+    res.json(await Widget.findById(req.params.id));',
      '+  } catch (err) {',
      '+    res.status(500).json({ error: "failed" });',
      '+  }',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /async route handler/i.test(i.message))).toBe(false);
  });

  it('flags a handler with no try/catch whose opening brace is on the line after the signature', () => {
    // Companion case to the regression above: confirms the fix doesn't
    // overcorrect into never flagging a next-line-brace handler at all --
    // one with genuinely no error handling still gets caught.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,4 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) =>',
      '+{',
      '+  res.json(await Widget.findById(req.params.id));',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('getWidget');
  });

  it('does not flag a try/catch-wrapped handler whose signature line has a trailing comment containing braces', () => {
    // Regression: maskStringLiterals masked string-literal content but not
    // comments, so a same-line trailing comment on the handler's signature
    // documenting a return shape (e.g. "// returns {id, name}") had its own
    // balanced '{'/'}' counted as real code structure by collectBoundedBlock.
    // Once that comment's braces balanced back to zero at the end of the
    // signature line, collectBoundedBlock (opened && depth <= 0) stopped
    // right there, never reaching the handler's real body -- including its
    // try/catch -- on the following lines. A fully try/catch-wrapped handler
    // was misflagged as missing error handling as a result. Confirmed via
    // git stash to fail against the pre-fix maskStringLiterals and pass
    // against the fix.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,9 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => // returns {id, name}',
      '+{',
      '+  try {',
      '+    res.json(await Widget.findById(req.params.id));',
      '+  } catch (err) {',
      '+    res.status(500).json({ error: "failed" });',
      '+  }',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /async route handler/i.test(i.message))).toBe(false);
  });

  it('flags an async handler with no try/catch even when the signature line has a trailing comment containing braces', () => {
    // Companion case to the regression above: confirms the comment-masking
    // fix doesn't overcorrect into never flagging a comment-on-signature
    // handler at all -- one with genuinely no error handling still gets
    // caught.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,5 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => // returns {id, name}',
      '+{',
      '+  res.json(await Widget.findById(req.params.id));',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('getWidget');
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

  it('does not flag a try/catch-wrapped handler whose opening brace is preceded by a comment-only line', () => {
    // Regression: collectStatement/handlerHasBraceBody's continuation check
    // ("this line isn't a `.`-chain continuation") treated any non-`.`-
    // starting line as ending the statement, including a comment-only line
    // -- so a handler with an explanatory comment between its signature and
    // its own opening brace was misclassified as brace-less and truncated
    // before ever reaching its real try/catch.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,8 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) =>',
      '+  // fetch and return the widget',
      '+  {',
      '+    try {',
      '+      res.json(await Widget.findById(req.params.id));',
      '+    } catch (err) {',
      '+      res.status(500).json({ error: err.message });',
      '+    }',
      '+  };',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /async route handler/i.test(i.message))).toBe(false);
  });

  it('flags a handler with no try/catch even when a comment sits between the signature and a brace with no real body', () => {
    // Companion to the case above: confirms the fix doesn't overcorrect
    // into never flagging this shape -- a handler with the same
    // comment-before-brace formatting but genuinely no try/catch inside
    // still gets caught.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,6 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) =>',
      '+  // fetch and return the widget',
      '+  {',
      '+    res.json(await Widget.findById(req.params.id));',
      '+  };',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('getWidget');
  });

  it('does not flag a .then()/.catch() chain with a comment-only line between the two calls', () => {
    // Regression: same continuation-check flaw as the brace-body case above
    // -- a comment-only line between `.then(doA)` and its own `.catch(...)`
    // was treated as ending the statement, truncating collectStatement's
    // window before it ever reached the chain's real .catch().
    const diff = [
      'diff --git a/src/jobs/runner.js b/src/jobs/runner.js',
      '--- a/src/jobs/runner.js',
      '+++ b/src/jobs/runner.js',
      '@@ -1,1 +1,5 @@',
      ' const job = require("./job");',
      '+job',
      '+  .then(doA)',
      '+  // explanatory comment about doA',
      '+  .catch(handleA);',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message))).toBe(false);
  });

  it('flags an async handler with no try/catch even when a comment inside the block mentions "try {" and "asyncHandler"', () => {
    // Regression: TRY_BLOCK/ASYNC_WRAPPER were tested against the raw,
    // unmasked block text, so a comment merely mentioning "try {" or
    // "asyncHandler" (e.g. a TODO) satisfied the check without any real
    // error handling present, silencing a genuine finding.
    const diff = [
      'diff --git a/src/controllers/widgetsController.js b/src/controllers/widgetsController.js',
      '--- a/src/controllers/widgetsController.js',
      '+++ b/src/controllers/widgetsController.js',
      '@@ -1,1 +1,5 @@',
      ' const Widget = require("../models/Widget");',
      '+exports.getWidget = async (req, res) => {',
      '+  // TODO: wrap this in try { ... } catch (err) { ... }, or use asyncHandler',
      '+  res.json(await Widget.findById(req.params.id));',
      '+};',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    const handlerIssues = issues.filter((i) => /async route handler/i.test(i.message));
    expect(handlerIssues).toHaveLength(1);
    expect(handlerIssues[0].message).toContain('getWidget');
  });

  it('flags a .then() call with no real .catch() even when a comment on the line mentions ".catch("', () => {
    // Same bug class and fix as the case above, for the .then()/.catch()
    // check: CATCH_CALL was tested against the raw window text, so a
    // trailing comment mentioning ".catch(" satisfied the check without a
    // real .catch() anywhere in the chain.
    const diff = [
      'diff --git a/src/jobs/runner.js b/src/jobs/runner.js',
      '--- a/src/jobs/runner.js',
      '+++ b/src/jobs/runner.js',
      '@@ -1,1 +1,3 @@',
      ' const job = require("./job");',
      '+job.then(doA); // should really add a .catch(handleA) here later',
    ].join('\n');

    const issues = errorHandlingRule.check(parseDiff(diff));
    expect(issues.some((i) => /\.then\(\) without a matching \.catch\(\)/i.test(i.message))).toBe(true);
  });
});
