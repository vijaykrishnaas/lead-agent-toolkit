const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const styleRule = require('../../src/rules/style');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('style rule', () => {
  it('flags "var" declarations and console.log calls', () => {
    const files = parseDiff(loadFixture('style-var-console.diff'));
    const issues = styleRule.check(files);

    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'low')).toBe(true);
    expect(issues.some((i) => /var/.test(i.message))).toBe(true);
    expect(issues.some((i) => /console\.log/.test(i.message))).toBe(true);
  });

  it('does not flag console.log inside test files', () => {
    const diff = [
      'diff --git a/tests/debug.test.js b/tests/debug.test.js',
      '--- a/tests/debug.test.js',
      '+++ b/tests/debug.test.js',
      '@@ -1,1 +1,2 @@',
      " test('x', () => {",
      '+  console.log("debugging");',
    ].join('\n');

    expect(styleRule.check(parseDiff(diff))).toEqual([]);
  });

  it('returns no issues for a clean diff', () => {
    const files = parseDiff(loadFixture('clean.diff'));
    expect(styleRule.check(files)).toEqual([]);
  });

  it('does not flag console.log in .test.ts / .spec.js files outside a tests/ dir', () => {
    for (const name of ['src/a.test.ts', 'src/a.spec.js', 'src/a.spec.tsx']) {
      const diff = [
        `diff --git a/${name} b/${name}`,
        `--- a/${name}`,
        `+++ b/${name}`,
        '@@ -1,1 +1,2 @@',
        " test('x', () => {",
        '+  console.log("debugging");',
      ].join('\n');
      expect(styleRule.check(parseDiff(diff))).toHaveLength(0);
    }
  });

  it('does not flag console.log in __tests__/ or test/ directories', () => {
    for (const name of ['src/__tests__/a.js', 'test/a.js']) {
      const diff = [
        `diff --git a/${name} b/${name}`,
        `--- a/${name}`,
        `+++ b/${name}`,
        '@@ -1,1 +1,2 @@',
        " test('x', () => {",
        '+  console.log("debugging");',
      ].join('\n');
      expect(styleRule.check(parseDiff(diff))).toHaveLength(0);
    }
  });

  it('does not flag a string literal that merely mentions "console.log(" as leftover debug code', () => {
    // Regression: CONSOLE_LOG matched raw line content, so a log/error
    // message string quoted verbatim into an added line (no actual
    // console.log call executing) was reported as leftover debug code.
    const diff = [
      'diff --git a/src/help.js b/src/help.js',
      '--- a/src/help.js',
      '+++ b/src/help.js',
      '@@ -1,1 +1,2 @@',
      ' const x = 1;',
      '+const msg = "call console.log(x) to debug";',
    ].join('\n');

    expect(styleRule.check(parseDiff(diff))).toEqual([]);
  });

  it('does not flag a commented-out console.log call as leftover debug code', () => {
    // Companion to the string-literal case above: a `//`-commented-out call
    // doesn't execute, so it isn't "left in source" as real debug code
    // either -- consistent with this repo's established masking-before-
    // detection discipline (see CLAUDE.md's "detect whether a code
    // construct exists at all" guideline), which treats a comment the same
    // as a string for this purpose: neither is live code.
    const diff = [
      'diff --git a/src/help.js b/src/help.js',
      '--- a/src/help.js',
      '+++ b/src/help.js',
      '@@ -1,1 +1,2 @@',
      ' const x = 1;',
      '+  // console.log(debugVal);',
    ].join('\n');

    expect(styleRule.check(parseDiff(diff))).toEqual([]);
  });

  it('flags "var" declared mid-line (for-init, after a brace) but not as a substring or in a string', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -0,0 +1,5 @@',
      '+for (var i = 0; i < 3; i++) {}',
      '+if (x) { var y = 1; }',
      '+const msg = "use var x here";',
      '+const variable = 1;',
      '+obj.var = 2;',
      '',
    ].join('\n');
    const issues = styleRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1, 2]);
  });

  it('flags `export var` declarations but not `var` as a property or substring', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -0,0 +1,3 @@',
      '+export var counter = 0;',
      '+exports.var = 1;',
      '+// export var in a comment',
      '',
    ].join('\n');
    const issues = styleRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1]);
  });

  it('flags "var" after a case/default label or a braceless else/do', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -0,0 +1,5 @@',
      '+case 1: var x = 1;',
      '+default: var y;',
      '+else var z = 2;',
      '+const variable = 1;',
      '+const o = { var: 1 };',
      '',
    ].join('\n');
    const issues = styleRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3]);
  });

  it('matches console.log as a whole token, including spaced and optional-chained forms', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -0,0 +1,6 @@',
      '+mockconsole.log(x);',
      '+const $console = { log() {} }; $console.log(x);',
      '+console . log(x);',
      '+console?.log(x);',
      '+window.console.log(x);',
      '+console.log(x);',
      '',
    ].join('\n');
    const issues = styleRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([3, 4, 5, 6]);
  });

  it('flags a console.log call inside a template-literal ${...} interpolation', () => {
    const diff = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -0,0 +1,2 @@',
      '+const s = `x ${console.log(1)}`;',
      '+const m = `plain console.log(1) text`;',
    ].join('\n');
    const issues = styleRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1]);
  });
});
