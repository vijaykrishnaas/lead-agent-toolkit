const { groupByAuthor } = require('../../src/standup/groupByAuthor');

describe('groupByAuthor', () => {
  it('groups commits and pull requests under their respective authors', () => {
    const commits = [
      { hash: 'a', author: 'Alice', date: 'd1', message: 'm1' },
      { hash: 'b', author: 'Bob', date: 'd2', message: 'm2' },
    ];
    const pullRequests = [{ number: 1, author: 'Alice', title: 't1', state: 'open' }];

    const groups = groupByAuthor({ commits, pullRequests });

    expect(groups.get('Alice')).toEqual({ commits: [commits[0]], pullRequests: [pullRequests[0]] });
    expect(groups.get('Bob')).toEqual({ commits: [commits[1]], pullRequests: [] });
  });

  it('buckets missing/blank authors under "Unknown" rather than dropping them', () => {
    const commits = [{ hash: 'a', author: '', date: 'd1', message: 'm1' }];
    const pullRequests = [{ number: 1, author: undefined, title: 't1', state: 'open' }];

    const groups = groupByAuthor({ commits, pullRequests });

    expect(groups.get('Unknown').commits).toEqual(commits);
    expect(groups.get('Unknown').pullRequests).toEqual(pullRequests);
  });

  it('returns an empty map for no commits and no pull requests', () => {
    expect(groupByAuthor({}).size).toBe(0);
    expect(groupByAuthor().size).toBe(0);
  });
});
