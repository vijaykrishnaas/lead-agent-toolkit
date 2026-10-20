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

  it.each([
    ['https://gitlab.com/o/r.git'],
    ['https://notgithub.com/o/r.git'],
    ['/local/path/to/repo'],
    ['https://github.com/only-owner'],
    [''],
    [undefined],
  ])('returns null for %s', (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});
