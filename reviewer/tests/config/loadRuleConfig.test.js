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

  describe('invalid values', () => {
    function loadWith(yamlText) {
      const fs = require('fs');
      const os = require('os');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
      const file = path.join(dir, 'rules.yaml');
      fs.writeFileSync(file, yamlText);
      const warn = jest.fn();
      const config = loadRuleConfig(file, { warn });
      return { config, warn };
    }

    it('warns on an invalid minSeverity but still falls back to "low"', () => {
      const { config, warn } = loadWith('rules:\n  security:\n    minSeverity: hgih\n');
      expect(config.rules.security.minSeverity).toBe('low');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/minSeverity.*security.*hgih/);
    });

    it('warns on a non-boolean enabled value', () => {
      const { config, warn } = loadWith('rules:\n  style:\n    enabled: "false"\n');
      expect(config.rules.style.enabled).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/enabled.*style/);
    });

    it('does not warn for valid or omitted values', () => {
      const { warn } = loadWith('rules:\n  security:\n    enabled: false\n    minSeverity: high\n  style: {}\n');
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns on a category that matches no known rule (typo would silently keep the rule on)', () => {
      const fs = require('fs');
      const os = require('os');
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-')), 'rules.yaml');
      fs.writeFileSync(file, 'rules:\n  securty:\n    enabled: false\n  style: {}\n');
      const warn = jest.fn();
      loadRuleConfig(file, { warn, knownCategories: ['security', 'style'] });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/unknown.*securty/);
    });

    it('does not warn about categories when no known list is supplied', () => {
      const { warn } = loadWith('rules:\n  anything:\n    enabled: false\n');
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns when "rules" is a list instead of a mapping', () => {
      const { config, warn } = loadWith('rules:\n  - security\n  - style\n');
      expect(config.rules).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/"rules".*mapping/);
    });

    it('warns when a category is a scalar (e.g. "style: false") instead of a settings mapping', () => {
      const { config, warn } = loadWith('rules:\n  style: false\n  security:\n');
      expect(config.rules.style.enabled).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/style.*mapping.*enabled: false/);
    });

    it('warns when "options" is a list instead of a mapping and uses empty options', () => {
      const { config, warn } = loadWith('rules:\n  missing-tests:\n    options: [src, lib]\n');
      expect(config.rules['missing-tests'].options).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/options.*missing-tests.*mapping/);
    });
  });
});
