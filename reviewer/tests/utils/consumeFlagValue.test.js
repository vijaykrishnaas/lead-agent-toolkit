const { consumeFlagValue } = require('../../src/utils/consumeFlagValue');

describe('consumeFlagValue', () => {
  it('returns the value at the given index', () => {
    expect(consumeFlagValue(['--out', 'report.md'], 1, '--out')).toBe('report.md');
  });

  it('throws when the value is undefined (flag was the last token)', () => {
    expect(() => consumeFlagValue(['--out'], 1, '--out')).toThrow('Missing value for --out.');
  });

  it('throws when the value looks like another flag, instead of silently consuming it', () => {
    expect(() => consumeFlagValue(['--out', '--repo', '/tmp'], 1, '--out')).toThrow('Missing value for --out.');
  });
});
