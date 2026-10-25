const { codeSpan } = require('../src/utils/codeSpan');

// Minimal CommonMark code-span decode: strip the fence, then one leading and
// trailing space when both exist and the content is not all spaces.
function decode(span) {
  const fence = /^`+/.exec(span)[0];
  let inner = span.slice(fence.length, span.length - fence.length);
  if (/^ .* $/s.test(inner) && /[^ ]/.test(inner)) inner = inner.slice(1, -1);
  return inner;
}

describe('codeSpan', () => {
  test('wraps plain text in single backticks', () => {
    expect(codeSpan('GET /users')).toBe('`GET /users`');
  });

  test('uses a fence longer than any inner backtick run', () => {
    expect(decode(codeSpan('a``b'))).toBe('a``b');
    expect(codeSpan('a``b').startsWith('```')).toBe(true);
  });

  test('collapses newlines', () => {
    expect(codeSpan('a\nb')).toBe('`a b`');
  });

  test('round-trips text with both a leading and a trailing space', () => {
    expect(decode(codeSpan(' a '))).toBe(' a ');
  });

  test('round-trips text with a leading/trailing backtick', () => {
    expect(decode(codeSpan('`a`'))).toBe('`a`');
  });
});
