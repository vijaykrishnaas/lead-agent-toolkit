const { parseGitHubRemote } = require('../../src/utils/parseGitHubRemote');

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/vijaykrishnaas/lead-agent-toolkit.git'],
    ['https://github.com/vijaykrishnaas/lead-agent-toolkit'],
    ['https://github.com/vijaykrishnaas/lead-agent-toolkit/'],
    ['https://x-access-token:abc@github.com/vijaykrishnaas/lead-agent-toolkit.git'],
    ['git@github.com:vijaykrishnaas/lead-agent-toolkit.git'],
    ['ssh://git@github.com/vijaykrishnaas/lead-agent-toolkit.git'],
  ])('parses %s', (url) => {
    expect(parseGitHubRemote(url)).toEqual({ owner: 'vijaykrishnaas', repo: 'lead-agent-toolkit' });
  });

  it('keeps dots inside the repo name', () => {
    expect(parseGitHubRemote('git@github.com:o/my.repo.git')).toEqual({ owner: 'o', repo: 'my.repo' });
  });

  it('accepts an explicit port on a scheme URL', () => {
    expect(parseGitHubRemote('ssh://git@github.com:22/o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseGitHubRemote('https://github.com:443/o/r')).toEqual({ owner: 'o', repo: 'r' });
  });

  it('matches scheme and host case-insensitively but preserves owner/repo case', () => {
    expect(parseGitHubRemote('HTTPS://GitHub.com/Owner/Repo.git')).toEqual({ owner: 'Owner', repo: 'Repo' });
  });

  it.each([
    ['https://gitlab.com/o/r.git'],
    ['https://notgithub.com/o/r.git'],
    ['/local/path/to/repo'],
    ['https://github.com/only-owner'],
    ['https://github.com/o/r?tab=readme'],
    ['https://github.com/o/r#readme'],
    ['https://github.com/o/.git'],
    ['https://github.com/../r'],
    ['https://github.com/./r'],
    [''],
    [undefined],
  ])('returns null for %s', (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});
