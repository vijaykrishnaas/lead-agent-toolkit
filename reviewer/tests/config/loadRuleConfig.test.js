const path = require('path');
const { loadRuleConfig } = require('../../src/config/loadRuleConfig');

function fixturePath(name) {
  return path.join(__dirname, '..', 'fixtures', 'config', name);
}

describe('loadRuleConfig', () => {
  it('normalizes an explicit config file', () => {
    const config = loadRuleConfig(fixturePath('custom-rules.yaml'));

    expect(config.rules.security).toEqual({ enabled: false, minSeverity: 'low', options: {} });
    expect(config.rules['error-handling']).toEqual({ enabled: true, minSeverity: 'high', options: {} });
    expect(config.rules['missing-tests']).toEqual({
      enabled: true,
      minSeverity: 'low',
      options: { sourceDirs: ['app/src'] },
    });
  });

  it('falls back to minSeverity "low" for an invalid severity value', () => {
    const config = loadRuleConfig(fixturePath('custom-rules.yaml'));
    expect(config.rules.style).toEqual({ enabled: true, minSeverity: 'low', options: {} });
  });

  it('returns an empty rules map (all rules run with defaults) when the file does not exist', () => {
    const config = loadRuleConfig(fixturePath('does-not-exist.yaml'));
    expect(config).toEqual({ rules: {} });
  });

  it('throws for a malformed (non-ENOENT) read failure', () => {
    expect(() => loadRuleConfig(__dirname)).toThrow();
  });

  it('loads the repo-root review-rules.yaml with MERN default sourceDirs', () => {
    const config = loadRuleConfig();
    expect(config.rules['missing-tests'].options.sourceDirs).toEqual(
      expect.arrayContaining(['src', 'lib', 'client/src', 'server/src', 'sample-app/src', 'reviewer/src']),
    );
    expect(config.rules.security.enabled).toBe(true);
  });
});
