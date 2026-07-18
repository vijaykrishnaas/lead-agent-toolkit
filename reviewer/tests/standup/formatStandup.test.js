const { formatStandupReport } = require('../../src/standup/formatStandup');

function makeGroups(entries) {
  return new Map(entries);
}

describe('formatStandupReport', () => {
  it('renders commits and pull requests per author, sorted alphabetically by author', () => {
    const groups = makeGroups([
      ['Bob', { commits: [{ hash: 'def4567890', author: 'Bob', date: '2026-07-18T08:00:00Z', message: 'Add feature' }], pullRequests: [] }],
      ['Alice', { commits: [], pullRequests: [{ number: 3, author: 'Alice', title: 'Fix thing', state: 'open' }] }],
    ]);

    const report = formatStandupReport(groups, { since: '2026-07-17T00:00:00.000Z' });

    expect(report).toContain('# Standup');
    expect(report).toContain('**Since:** 2026-07-17T00:00:00.000Z');
    const aliceIndex = report.indexOf('## Alice');
    const bobIndex = report.indexOf('## Bob');
    expect(aliceIndex).toBeGreaterThan(-1);
    expect(bobIndex).toBeGreaterThan(aliceIndex);
    expect(report).toContain('- `def4567` Add feature');
    expect(report).toContain('- #3 Fix thing (open)');
  });

  it('marks an author with no commits or pull requests as having no activity', () => {
    const groups = makeGroups([['Carol', { commits: [], pullRequests: [] }]]);

    const report = formatStandupReport(groups);

    expect(report).toContain('## Carol');
    expect(report).toContain('_No activity._');
  });

  it('reports no activity at all when the group map is empty', () => {
    const report = formatStandupReport(new Map());
    expect(report).toContain('No commits or pull requests in the last 24h.');
  });

  it('sorts commits chronologically and pull requests by number within an author', () => {
    const groups = makeGroups([
      [
        'Alice',
        {
          commits: [
            { hash: 'bbbbbbbbbb', author: 'Alice', date: '2026-07-18T09:00:00Z', message: 'Second' },
            { hash: 'aaaaaaaaaa', author: 'Alice', date: '2026-07-18T08:00:00Z', message: 'First' },
          ],
          pullRequests: [
            { number: 5, author: 'Alice', title: 'PR five', state: 'open' },
            { number: 2, author: 'Alice', title: 'PR two', state: 'merged' },
          ],
        },
      ],
    ]);

    const report = formatStandupReport(groups);

    expect(report.indexOf('First')).toBeLessThan(report.indexOf('Second'));
    expect(report.indexOf('PR two')).toBeLessThan(report.indexOf('PR five'));
  });
});
