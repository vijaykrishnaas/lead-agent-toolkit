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
});
