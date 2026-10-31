const fs = require('fs');
const path = require('path');
const { parseDiff } = require('../../src/diffParser');
const securityRule = require('../../src/rules/security');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('security rule', () => {
  it('flags a hardcoded API key as a high-severity issue', () => {
    const files = parseDiff(loadFixture('security-hardcoded-secret.diff'));
    const issues = securityRule.check(files);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'src/config/thirdParty.js',
      severity: 'high',
    });
    expect(issues[0].message).toMatch(/hardcoded credential/i);
  });

  it('does not flag secrets read from process.env', () => {
    const diff = [
      'diff --git a/src/config/thirdParty.js b/src/config/thirdParty.js',
      '--- a/src/config/thirdParty.js',
      '+++ b/src/config/thirdParty.js',
      '@@ -1,1 +1,2 @@',
      ' const axios = require("axios");',
      '+const apiKey = process.env.API_KEY;',
    ].join('\n');

    const issues = securityRule.check(parseDiff(diff));
    expect(issues).toHaveLength(0);
  });

  it('still flags a hardcoded secret when process.env is mentioned elsewhere on the same line', () => {
    // A trailing process.env reference (a fallback expression, or even just
    // a comment) must not silence a real hardcoded literal earlier on the
    // same line -- the exemption only makes sense when process.env IS the
    // assigned value, not merely present somewhere in the line.
    const diff = [
      'diff --git a/src/config/thirdParty.js b/src/config/thirdParty.js',
      '--- a/src/config/thirdParty.js',
      '+++ b/src/config/thirdParty.js',
      '@@ -1,1 +1,2 @@',
      ' const axios = require("axios");',
      '+const password = "hunter2"; // fallback for process.env.PASSWORD',
    ].join('\n');

    const issues = securityRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/hardcoded credential/i);
  });

  it('flags a hardcoded literal used as the fallback of a process.env read', () => {
    // `password = process.env.X || 'literal'` is the common idiom for
    // shipping a default secret; the quote is not immediately after the
    // operator, but the literal is still a hardcoded credential.
    const diff = [
      'diff --git a/src/config/thirdParty.js b/src/config/thirdParty.js',
      '--- a/src/config/thirdParty.js',
      '+++ b/src/config/thirdParty.js',
      '@@ -1,1 +1,3 @@',
      ' const axios = require("axios");',
      "+const password = process.env.PASSWORD || 'hunter22';",
      '+const apiKey = process.env.API_KEY ?? "abcdef";',
    ].join('\n');

    const issues = securityRule.check(parseDiff(diff));
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toMatch(/hardcoded credential/i);
  });

  it('does not flag a process.env read with an empty or short fallback', () => {
    const diff = [
      'diff --git a/src/config/thirdParty.js b/src/config/thirdParty.js',
      '--- a/src/config/thirdParty.js',
      '+++ b/src/config/thirdParty.js',
      '@@ -1,1 +1,3 @@',
      ' const axios = require("axios");',
      "+const password = process.env.PASSWORD || '';",
      '+const apiKey = process.env.API_KEY || process.env.OTHER_KEY;',
    ].join('\n');

    expect(securityRule.check(parseDiff(diff))).toHaveLength(0);
  });

  it('flags eval() usage', () => {
    const diff = [
      'diff --git a/src/utils/parse.js b/src/utils/parse.js',
      '--- a/src/utils/parse.js',
      '+++ b/src/utils/parse.js',
      '@@ -1,1 +1,2 @@',
      ' function parse(input) {',
      '+  return eval(input);',
    ].join('\n');

    const issues = securityRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/eval/i);
  });

  it('flags eval() reached via bracket-property access (a one-line evasion of a direct eval( match)', () => {
    const diff = [
      'diff --git a/src/utils/parse.js b/src/utils/parse.js',
      '--- a/src/utils/parse.js',
      '+++ b/src/utils/parse.js',
      '@@ -1,1 +1,2 @@',
      ' function parse(input) {',
      "+  return global['eval'](input);",
    ].join('\n');

    const issues = securityRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/eval/i);
  });

  it('flags eval() reached via double-quoted bracket-property access', () => {
    const diff = [
      'diff --git a/src/utils/parse.js b/src/utils/parse.js',
      '--- a/src/utils/parse.js',
      '+++ b/src/utils/parse.js',
      '@@ -1,1 +1,2 @@',
      ' function parse(input) {',
      '+  return window["eval"](input);',
    ].join('\n');

    const issues = securityRule.check(parseDiff(diff));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/eval/i);
  });

  it('returns no issues for a clean diff', () => {
    const files = parseDiff(loadFixture('clean.diff'));
    expect(securityRule.check(files)).toEqual([]);
  });

  it('flags a hardcoded credential assigned via a quoted object key', () => {
    const diff = [
      'diff --git a/src/c.js b/src/c.js',
      '--- a/src/c.js',
      '+++ b/src/c.js',
      '@@ -0,0 +1,3 @@',
      '+const a = { "password": "hunter22" };',
      "+const b = { 'apiKey': 'abcd1234' };",
      "+const c = { 'token': process.env.T };",
      '',
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1, 2]);
  });

  it('does not flag eval( that appears only in a comment, but still flags code before a trailing comment', () => {
    const diff = [
      'diff --git a/src/c.js b/src/c.js',
      '--- a/src/c.js',
      '+++ b/src/c.js',
      '@@ -0,0 +1,3 @@',
      '+// never call eval(x) here',
      '+const a = 1; /* eval(a) */',
      '+const b = eval(input); // risky',
      '',
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([3]);
  });

  it('does not flag eval( that appears only inside a string literal, but still flags real calls and the bracket form', () => {
    const diff = [
      'diff --git a/src/d.js b/src/d.js',
      '--- a/src/d.js',
      '+++ b/src/d.js',
      '@@ -0,0 +1,4 @@',
      "+const msg = 'never call eval(x) here';",
      '+const hint = `avoid eval(` + name + `)`;',
      "+const out = eval('1'); const note = 'eval(y)';",
      "+const g = global['eval'](input);",
      '',
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([3, 4]);
  });

  it('flags eval( inside a template-literal ${} interpolation', () => {
    const diff = [
      'diff --git a/src/e.js b/src/e.js',
      '--- a/src/e.js',
      '+++ b/src/e.js',
      '@@ -0,0 +1,2 @@',
      '+const a = `x ${eval(input)}`;',
      "+const b = `plain eval(x) text`;",
      '',
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1]);
  });
});
