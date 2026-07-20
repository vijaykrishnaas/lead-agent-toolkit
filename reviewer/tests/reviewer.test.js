const fs = require('fs');
const path = require('path');
const { reviewDiff } = require('../src/reviewer');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

describe('reviewDiff', () => {
  it('returns risk "none" and no issues for a clean diff', () => {
    const result = reviewDiff(loadFixture('clean.diff'));
    expect(result).toEqual({ risk: 'none', issues: [] });
  });

  it('returns risk "high" and a security issue for a hardcoded secret', () => {
    const result = reviewDiff(loadFixture('security-hardcoded-secret.diff'));
    expect(result.risk).toBe('high');
    expect(result.issues.some((i) => i.category === 'security')).toBe(true);
    for (const issue of result.issues) {
      expect(issue).toEqual(
        expect.objectContaining({
          file: expect.any(String),
          line: expect.any(Number),
          category: expect.any(String),
          severity: expect.stringMatching(/^(high|medium|low)$/),
          message: expect.any(String),
          fix: expect.any(String),
        }),
      );
    }
  });

  it('returns risk "high" for a missing try/catch async handler', () => {
    const result = reviewDiff(loadFixture('error-handling-no-catch.diff'));
    expect(result.risk).toBe('high');
    expect(result.issues.some((i) => i.category === 'error-handling')).toBe(true);
  });

  it('returns risk "medium" for a missing-tests-only diff', () => {
    const result = reviewDiff(loadFixture('missing-tests.diff'));
    expect(result.risk).toBe('medium');
    expect(result.issues).toEqual([
      expect.objectContaining({ category: 'missing-tests', severity: 'medium' }),
    ]);
  });

  it('returns risk "medium" for the await-in-forEach performance issue', () => {
    const result = reviewDiff(loadFixture('performance-await-in-foreach.diff'));
    expect(result.risk).toBe('medium');
    expect(result.issues.some((i) => i.category === 'performance')).toBe(true);
  });

  it('returns risk "low" when only style issues are present, alongside the expected missing-tests issue', () => {
    const result = reviewDiff(loadFixture('style-var-console.diff'));
    const categories = result.issues.map((i) => i.category).sort();
    expect(categories).toEqual(['missing-tests', 'style', 'style']);
    expect(result.risk).toBe('medium');
  });

  it('supports a custom rule set instead of the defaults', () => {
    const alwaysFlag = {
      category: 'custom',
      check: () => [{ file: 'src/x.js', line: 1, severity: 'low', message: 'custom', fix: 'custom fix' }],
    };
    const result = reviewDiff(loadFixture('clean.diff'), [alwaysFlag]);
    expect(result).toEqual({
      risk: 'low',
      issues: [
        { file: 'src/x.js', line: 1, category: 'custom', severity: 'low', message: 'custom', fix: 'custom fix' },
      ],
    });
  });

  it('resolves and attaches each file\'s post-image content via git show when execGit/repo/sha options are given', () => {
    const capturedFiles = [];
    const captureRule = {
      category: 'capture',
      check: (files) => {
        capturedFiles.push(...files);
        return [];
      },
    };
    const execGit = jest.fn(() => 'const widget = 1;\n');

    reviewDiff(loadFixture('error-handling-no-catch.diff'), [captureRule], {
      execGit,
      repo: '/repo',
      sha: 'deadbeef',
    });

    expect(execGit).toHaveBeenCalledWith(['show', 'deadbeef:src/controllers/widgetsController.js'], '/repo');
    expect(capturedFiles[0].content).toBe('const widget = 1;\n');
  });

  it('does not attach content, and rules see the diff-only files exactly as before, when no options are given', () => {
    const capturedFiles = [];
    const captureRule = {
      category: 'capture',
      check: (files) => {
        capturedFiles.push(...files);
        return [];
      },
    };

    reviewDiff(loadFixture('error-handling-no-catch.diff'), [captureRule]);

    expect(capturedFiles[0].content).toBeUndefined();
  });

  it('leaves content unattached (and rules unaffected) when git show fails for a file', () => {
    const result = reviewDiff(loadFixture('error-handling-no-catch.diff'), undefined, {
      execGit: () => {
        throw new Error('fatal: not found');
      },
      repo: '/repo',
      sha: 'deadbeef',
    });

    expect(result.issues.some((i) => i.category === 'error-handling')).toBe(true);
  });
});
