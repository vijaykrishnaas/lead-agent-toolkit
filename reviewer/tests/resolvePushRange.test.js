const { resolvePushRange } = require('../../scripts/resolvePushRange');

const ZERO_SHA = '0000000000000000000000000000000000000000';
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function fakeExecGit(existingRefs) {
  return jest.fn((gitArgs) => {
    const ref = gitArgs[gitArgs.length - 1];
    if (existingRefs.has(ref)) return '';
    const err = new Error(`fatal: Needed a single revision (${ref})`);
    throw err;
  });
}

describe('resolvePushRange', () => {
  it('uses before..after when before resolves to a real commit', () => {
    const execGit = fakeExecGit(new Set(['before-sha^{commit}']));

    const range = resolvePushRange({ before: 'before-sha', after: 'after-sha', execGit });

    expect(range).toBe('before-sha..after-sha');
  });

  it('falls back to after^..after when before is the all-zero SHA (first push to a branch)', () => {
    const execGit = fakeExecGit(new Set(['after-sha^']));

    const range = resolvePushRange({ before: ZERO_SHA, after: 'after-sha', execGit });

    expect(range).toBe('after-sha^..after-sha');
  });

  it('falls back to after^..after when before is empty', () => {
    const execGit = fakeExecGit(new Set(['after-sha^']));

    const range = resolvePushRange({ before: '', after: 'after-sha', execGit });

    expect(range).toBe('after-sha^..after-sha');
  });

  it('falls back to after^..after when before is unresolvable (e.g. a force-push rewrote history)', () => {
    const execGit = fakeExecGit(new Set(['after-sha^']));

    const range = resolvePushRange({ before: 'gone-sha', after: 'after-sha', execGit });

    expect(range).toBe('after-sha^..after-sha');
  });

  it('falls back to the empty tree when after has no parent (a repo/branch root commit)', () => {
    const execGit = fakeExecGit(new Set());

    const range = resolvePushRange({ before: ZERO_SHA, after: 'root-sha', execGit });

    expect(range).toBe(`${EMPTY_TREE_SHA}..root-sha`);
  });

  it('throws when after is missing', () => {
    const execGit = fakeExecGit(new Set());

    expect(() => resolvePushRange({ before: 'before-sha', after: '', execGit })).toThrow(
      /requires a non-empty "after"/
    );
  });
});
