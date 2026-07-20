const { resolveFileContent } = require('../../src/utils/resolveFileContent');

describe('resolveFileContent', () => {
  it('returns the content from `git show <sha>:<path>`', () => {
    const execGit = jest.fn(() => 'const x = 1;\n');

    const content = resolveFileContent({ execGit, repo: '/repo', sha: 'abc123', path: 'src/x.js' });

    expect(content).toBe('const x = 1;\n');
    expect(execGit).toHaveBeenCalledWith(['show', 'abc123:src/x.js'], '/repo');
  });

  it('returns null (never throws) when execGit throws', () => {
    const execGit = () => {
      throw new Error('fatal: path does not exist in sha');
    };

    expect(resolveFileContent({ execGit, repo: '/repo', sha: 'abc123', path: 'src/deleted.js' })).toBeNull();
  });
});
