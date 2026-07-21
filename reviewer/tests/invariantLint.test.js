const { lintInvariants, splitRange, tasksChangedSubstantively } = require('../../scripts/invariantLint');

function fakeExecGit({ files, contents }) {
  return jest.fn((gitArgs) => {
    if (gitArgs[0] === 'diff' && gitArgs[1] === '--name-only') {
      return files.join('\n');
    }
    if (gitArgs[0] === 'show') {
      const spec = gitArgs[1];
      const sepIndex = spec.indexOf(':');
      const ref = spec.slice(0, sepIndex);
      const filePath = spec.slice(sepIndex + 1);
      const content = contents[ref] && contents[ref][filePath];
      if (content === undefined || content === null) {
        throw new Error(`fatal: path '${filePath}' does not exist in '${ref}'`);
      }
      return content;
    }
    throw new Error(`unexpected git invocation: ${gitArgs.join(' ')}`);
  });
}

describe('lintInvariants', () => {
  it('passes cleanly when no relevant files changed', () => {
    const execGit = fakeExecGit({ files: ['reviewer/src/index.js'], contents: {} });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });

  it('flags a removed TASKS.md task line', () => {
    const execGit = fakeExecGit({
      files: ['TASKS.md'],
      contents: {
        base: { 'TASKS.md': '1. [DONE] first task\n2. second task\n3. third task\n' },
        head: { 'TASKS.md': '1. [DONE] first task\n3. third task\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('task 2.'))).toBe(true);
  });

  it('does not require a changelog addition for marking an existing task [DONE] in place', () => {
    // Matches ~10 real prior commits' established precedent (SKILL_CHANGELOG.md):
    // marking an existing task [DONE], with wording/order unchanged, is not logged.
    const execGit = fakeExecGit({
      files: ['TASKS.md'],
      contents: {
        base: { 'TASKS.md': '1. first task\n2. second task\n' },
        head: { 'TASKS.md': '1. [DONE] first task\n2. second task\n' },
      },
    });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });

  it('does not require a changelog addition for re-tagging (e.g. [DONE] -> [BLOCKED: reason]) in place', () => {
    const execGit = fakeExecGit({
      files: ['TASKS.md'],
      contents: {
        base: { 'TASKS.md': '1. [DONE] first task\n' },
        head: { 'TASKS.md': '1. [BLOCKED: reason] first task\n' },
      },
    });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });

  it('requires a changelog addition when task lines are reordered', () => {
    const execGit = fakeExecGit({
      files: ['TASKS.md'],
      contents: {
        base: { 'TASKS.md': '1. first task\n2. second task\n' },
        head: { 'TASKS.md': '2. second task\n1. [DONE] first task\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('SKILL_CHANGELOG.md addition'))).toBe(true);
  });

  it('requires a changelog addition when an existing task\'s wording is edited', () => {
    const execGit = fakeExecGit({
      files: ['TASKS.md'],
      contents: {
        base: { 'TASKS.md': '1. first task\n' },
        head: { 'TASKS.md': '1. [DONE] first task, reworded\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('SKILL_CHANGELOG.md addition'))).toBe(true);
  });

  it('does not flag a newly created TASKS.md when paired with a changelog addition', () => {
    const execGit = fakeExecGit({
      files: ['TASKS.md', 'SKILL_CHANGELOG.md'],
      contents: {
        base: { 'SKILL_CHANGELOG.md': '## prior entry\n' },
        head: { 'TASKS.md': '1. first task\n', 'SKILL_CHANGELOG.md': '## prior entry\n## new entry\n' },
      },
    });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });

  it('flags removed PROGRESS.md content', () => {
    const execGit = fakeExecGit({
      files: ['PROGRESS.md'],
      contents: {
        base: { 'PROGRESS.md': '## 2026-07-01\nsome entry\n' },
        head: { 'PROGRESS.md': '## 2026-07-01\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('PROGRESS.md') && v.includes('some entry'))).toBe(true);
  });

  it('does not flag appending PROGRESS.md content', () => {
    const execGit = fakeExecGit({
      files: ['PROGRESS.md'],
      contents: {
        base: { 'PROGRESS.md': '## 2026-07-01\nsome entry\n' },
        head: { 'PROGRESS.md': '## 2026-07-01\nsome entry\n## 2026-07-02\nnew entry\n' },
      },
    });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });

  it('flags removed SKILL_CHANGELOG.md content', () => {
    const execGit = fakeExecGit({
      files: ['SKILL_CHANGELOG.md'],
      contents: {
        base: { 'SKILL_CHANGELOG.md': '## entry one\ndetail\n' },
        head: { 'SKILL_CHANGELOG.md': '## entry one\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('SKILL_CHANGELOG.md') && v.includes('detail'))).toBe(true);
  });

  it('flags CLAUDE.md changed without a SKILL_CHANGELOG.md addition', () => {
    const execGit = fakeExecGit({
      files: ['CLAUDE.md'],
      contents: {
        base: { 'CLAUDE.md': 'old rule\n', 'SKILL_CHANGELOG.md': '## prior entry\n' },
        head: { 'CLAUDE.md': 'old rule\nnew rule\n', 'SKILL_CHANGELOG.md': '## prior entry\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('SKILL_CHANGELOG.md addition'))).toBe(true);
  });

  it('does not flag CLAUDE.md changed together with a SKILL_CHANGELOG.md addition', () => {
    const execGit = fakeExecGit({
      files: ['CLAUDE.md', 'SKILL_CHANGELOG.md'],
      contents: {
        base: { 'CLAUDE.md': 'old rule\n', 'SKILL_CHANGELOG.md': '## prior entry\n' },
        head: {
          'CLAUDE.md': 'old rule\nnew rule\n',
          'SKILL_CHANGELOG.md': '## prior entry\n## new entry\ndetail\n',
        },
      },
    });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });

  it('flags a .claude/skills/ change without a SKILL_CHANGELOG.md addition', () => {
    const execGit = fakeExecGit({
      files: ['.claude/skills/review-pr/SKILL.md'],
      contents: {
        base: { 'SKILL_CHANGELOG.md': '## prior entry\n' },
        head: { 'SKILL_CHANGELOG.md': '## prior entry\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('SKILL_CHANGELOG.md addition'))).toBe(true);
  });

  it('flags a TASKS.md change without a SKILL_CHANGELOG.md addition', () => {
    const execGit = fakeExecGit({
      files: ['TASKS.md'],
      contents: {
        base: { 'TASKS.md': '1. first task\n', 'SKILL_CHANGELOG.md': '## prior entry\n' },
        head: { 'TASKS.md': '1. first task\n2. new task\n', 'SKILL_CHANGELOG.md': '## prior entry\n' },
      },
    });
    const violations = lintInvariants({ range: 'base..head', execGit });
    expect(violations.some((v) => v.includes('SKILL_CHANGELOG.md addition'))).toBe(true);
  });

  it('does not require a SKILL_CHANGELOG.md addition for unrelated file changes', () => {
    const execGit = fakeExecGit({ files: ['reviewer/src/cli.js'], contents: {} });
    expect(lintInvariants({ range: 'base..head', execGit })).toEqual([]);
  });
});

describe('tasksChangedSubstantively', () => {
  it('is false when only a bracket tag is added', () => {
    expect(tasksChangedSubstantively('1. a task\n', '1. [DONE] a task\n')).toBe(false);
  });

  it('is true when TASKS.md is newly created (every task is new)', () => {
    expect(tasksChangedSubstantively(null, '1. a task\n')).toBe(true);
  });

  it('is true when a task is added', () => {
    expect(tasksChangedSubstantively('1. a task\n', '1. a task\n2. another task\n')).toBe(true);
  });

  it('is true when an existing task is reordered relative to another', () => {
    expect(
      tasksChangedSubstantively('1. first\n2. second\n', '2. second\n1. [DONE] first\n')
    ).toBe(true);
  });

  it('is true when an existing task\'s wording changes', () => {
    expect(tasksChangedSubstantively('1. a task\n', '1. [DONE] a different task\n')).toBe(true);
  });
});

describe('splitRange', () => {
  it('splits a "<base>..<head>" range', () => {
    expect(splitRange('abc..def')).toEqual({ base: 'abc', head: 'def' });
  });

  it('throws a clear error for a malformed range', () => {
    expect(() => splitRange('not-a-range')).toThrow(/expected/);
  });
});
