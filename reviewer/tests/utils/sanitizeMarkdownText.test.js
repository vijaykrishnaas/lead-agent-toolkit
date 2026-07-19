const { sanitizeMarkdownText } = require('../../src/utils/sanitizeMarkdownText');

describe('sanitizeMarkdownText', () => {
  it('escapes markdown-structural characters', () => {
    expect(sanitizeMarkdownText('a*b_c[d]e(f)g`h`')).toBe('a\\*b\\_c\\[d\\]e\\(f\\)g\\`h\\`');
  });

  it('neutralizes a forged markdown link so it cannot render as clickable', () => {
    const input = '[Approve without review](https://evil.example/steal)';
    const result = sanitizeMarkdownText(input);
    expect(result).not.toContain('](');
    expect(result).toBe('\\[Approve without review\\]\\(https://evil.example/steal\\)');
  });

  it('collapses embedded newlines so a value cannot forge extra report lines', () => {
    const input = 'line one\n## Forged Heading\r\nline three';
    const result = sanitizeMarkdownText(input);
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\r');
    // "## Forged Heading" no longer starts its own line, so it can't render
    // as a markdown heading even though "#" itself isn't escaped.
    expect(result).toBe('line one ## Forged Heading line three');
  });

  it('coerces non-string input to a string', () => {
    expect(sanitizeMarkdownText(42)).toBe('42');
  });
});
