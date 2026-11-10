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

  it('flags new Function(...) / Function(...) construction as dynamic code execution, not mentions in strings', () => {
    const mk = (line) => parseDiff([
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,1 +1,2 @@',
      ' x',
      `+${line}`,
    ].join('\n'));
    expect(securityRule.check(mk('const f = new Function("a", "return " + a);'))).toHaveLength(1);
    expect(securityRule.check(mk('const f = Function("return this")();'))).toHaveLength(1);
    expect(securityRule.check(mk('const s = "use new Function(x) rarely";'))).toHaveLength(0);
    expect(securityRule.check(mk('// new Function(x)'))).toHaveLength(0);
    expect(securityRule.check(mk('const g = myFunction(x);'))).toHaveLength(0);
    expect(securityRule.check(mk('function Function2() {}'))).toHaveLength(0);
  });

  it('flags Function construction reached through a global object (window/globalThis/global/self), but not other member calls', () => {
    const mk = (line) => parseDiff([
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,1 +1,2 @@',
      ' x',
      `+${line}`,
    ].join('\n'));
    expect(securityRule.check(mk('const f = new globalThis.Function("a", "return " + a);'))).toHaveLength(1);
    expect(securityRule.check(mk('const f = window.Function(code);'))).toHaveLength(1);
    expect(securityRule.check(mk('const f = global?.Function(code);'))).toHaveLength(1);
    expect(securityRule.check(mk('const f = self . Function(code);'))).toHaveLength(1);
    expect(securityRule.check(mk('const s = "globalThis.Function(x)";'))).toHaveLength(0);
    expect(securityRule.check(mk('// window.Function(x)'))).toHaveLength(0);
    expect(securityRule.check(mk('const f = lodash.Function(x);'))).toHaveLength(0);
    expect(securityRule.check(mk('const f = mywindow.Function(x);'))).toHaveLength(0);
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

  it('flags eval() reached via backtick-quoted bracket-property access', () => {
    const diff = [
      'diff --git a/src/utils/parse.js b/src/utils/parse.js',
      '--- a/src/utils/parse.js',
      '+++ b/src/utils/parse.js',
      '@@ -1,1 +1,2 @@',
      ' function parse(input) {',
      '+  return global[`eval`](input);',
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
  it('flags hardcoded credentials named with a Key suffix (secretKey, secret_key, tokenKey)', () => {
    const diff = [
      'diff --git a/src/k.js b/src/k.js',
      '--- a/src/k.js',
      '+++ b/src/k.js',
      '@@ -0,0 +1,4 @@',
      "+const cfg = { secretKey: 'abc123' };",
      "+const secret_key = 'abc123';",
      "+const passwordKey = 'abc123';",
      "+const keyboard = 'abc123';",
      '',
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3]);
  });

  it('flags eval() reached via optional call (eval?.(x)) and indirect comma call ((0, eval)(x))', () => {
    const diff = [
      'diff --git a/src/run.js b/src/run.js',
      '--- a/src/run.js',
      '+++ b/src/run.js',
      '@@ -0,0 +1,4 @@',
      '+const a = eval?.(input);',
      '+const b = (0, eval)(input);',
      '+const c = (0,eval) (input);',
      "+const d = 'safe: eval?.(x)';",
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3]);
  });

  it('does not flag Puppeteer/Playwright-style $eval( / $$eval( helpers, but still flags a real member eval(', () => {
    const diff = [
      'diff --git a/src/run.js b/src/run.js',
      '--- a/src/run.js',
      '+++ b/src/run.js',
      '@@ -0,0 +1,3 @@',
      "+const t = await page.$eval('h1', (el) => el.textContent);",
      "+const all = await page.$$eval('li', (els) => els.length);",
      '+const r = vm.eval(input);',
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.map((i) => i.line)).toEqual([3]);
  });
  it('does not echo the secret literal into the issue message (report is posted to PR comments)', () => {
    const diff = [
      'diff --git a/src/c.js b/src/c.js',
      '--- a/src/c.js',
      '+++ b/src/c.js',
      '@@ -1,1 +1,3 @@',
      ' const x = 1;',
      "+const apiKey = 'sk_live_SUPERSECRET123';",
      "+const t = process.env.T; const password = 'hunter2hunter2' || process.env.P;",
    ].join('\n');
    const issues = securityRule.check(parseDiff(diff));
    expect(issues.length).toBeGreaterThanOrEqual(2);
    for (const issue of issues) {
      expect(issue.message).toMatch(/hardcoded credential/i);
      expect(issue.message).not.toMatch(/SUPERSECRET123|hunter2/);
      expect(issue.message).toMatch(/apiKey|password/);
    }
  });
  it('redacts the secret even when earlier quotes on the line would misalign quote pairing', () => {
    const lines = [
      "const m = \"it's\"; const password = \"hunter2hunter2\";",
      "const a = \"x\"; const m = \"don't\", password = \"hunter2hunter2\";",
    ];
    for (const l of lines) {
      const diff = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1,1 +1,2 @@', ' x', '+' + l].join('\n');
      const issues = securityRule.check(parseDiff(diff));
      expect(issues).toHaveLength(1);
      expect(issues[0].message).not.toMatch(/hunter2/);
      expect(issues[0].message).toMatch(/password/);
    }
  });
});
