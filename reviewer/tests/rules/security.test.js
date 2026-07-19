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
});
