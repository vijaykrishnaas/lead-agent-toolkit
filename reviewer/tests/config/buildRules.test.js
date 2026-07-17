const { buildRules } = require('../../src/config/buildRules');

function makeRule(category, issues) {
  return { category, check: jest.fn(() => issues) };
}

describe('buildRules', () => {
  it('drops a category whose config disables it', () => {
    const security = makeRule('security', [{ file: 'a.js', line: 1, severity: 'high', message: 'm', fix: 'f' }]);
    const style = makeRule('style', [{ file: 'a.js', line: 2, severity: 'low', message: 'm', fix: 'f' }]);

    const rules = buildRules({ rules: { security: { enabled: false } } }, [security, style]);

    expect(rules.map((r) => r.category)).toEqual(['style']);
  });

  it('filters out issues below the configured minSeverity for that category', () => {
    const style = makeRule('style', [
      { file: 'a.js', line: 1, severity: 'low', message: 'low issue', fix: 'f' },
      { file: 'a.js', line: 2, severity: 'medium', message: 'medium issue', fix: 'f' },
    ]);

    const rules = buildRules({ rules: { style: { enabled: true, minSeverity: 'medium' } } }, [style]);

    expect(rules[0].check([])).toEqual([
      { file: 'a.js', line: 2, severity: 'medium', message: 'medium issue', fix: 'f' },
    ]);
  });

  it('passes category options through to the rule as a second check() argument', () => {
    const missingTests = { category: 'missing-tests', check: jest.fn(() => []) };
    const options = { sourceDirs: ['app/src'] };

    const rules = buildRules({ rules: { 'missing-tests': { enabled: true, minSeverity: 'low', options } } }, [
      missingTests,
    ]);
    rules[0].check(['some-files']);

    expect(missingTests.check).toHaveBeenCalledWith(['some-files'], options);
  });

  it('defaults an unconfigured category to enabled with minSeverity low and no options', () => {
    const performance = makeRule('performance', [
      { file: 'a.js', line: 1, severity: 'low', message: 'm', fix: 'f' },
    ]);

    const rules = buildRules({ rules: {} }, [performance]);

    expect(rules).toHaveLength(1);
    expect(rules[0].check([])).toHaveLength(1);
  });
});
