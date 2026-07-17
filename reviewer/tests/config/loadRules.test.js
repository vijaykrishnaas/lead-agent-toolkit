const fs = require('fs');
const path = require('path');
const { reviewDiff } = require('../../src/reviewer');
const { loadRules } = require('../../src/config/loadRules');

function fixturePath(...segments) {
  return path.join(__dirname, '..', 'fixtures', ...segments);
}

function loadFixture(name) {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

describe('loadRules integration', () => {
  it('produces a rules array reviewDiff can use directly', () => {
    const rules = loadRules(fixturePath('config', 'custom-rules.yaml'));
    const result = reviewDiff(loadFixture('security-hardcoded-secret.diff'), rules);

    // security is disabled in the fixture config, so no security issue is reported.
    expect(result.issues.some((i) => i.category === 'security')).toBe(false);
  });

  it('honors minSeverity overrides end-to-end', () => {
    const rules = loadRules(fixturePath('config', 'custom-rules.yaml'));
    const result = reviewDiff(loadFixture('error-handling-no-catch.diff'), rules);

    expect(result.issues.some((i) => i.category === 'error-handling' && i.severity === 'high')).toBe(true);
  });

  it('loading the repo-root review-rules.yaml reproduces the default reviewer behavior for existing fixtures', () => {
    const rules = loadRules();
    const defaultResult = reviewDiff(loadFixture('security-hardcoded-secret.diff'));
    const configuredResult = reviewDiff(loadFixture('security-hardcoded-secret.diff'), rules);

    expect(configuredResult).toEqual(defaultResult);
  });
});
