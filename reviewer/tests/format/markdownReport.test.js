const { formatMarkdownReport } = require('../../src/format/markdownReport');

describe('formatMarkdownReport', () => {
  it('renders a no-issues report', () => {
    const report = formatMarkdownReport({ risk: 'none', issues: [] }, { range: 'a..b' });
    expect(report).toContain('# Code Review Report');
    expect(report).toContain('**Range:** `a..b`');
    expect(report).toContain('**Risk:** none');
    expect(report).toContain('No issues found.');
  });

  it('groups issues by category and sorts by severity within a category', () => {
    const result = {
      risk: 'high',
      issues: [
        { file: 'src/b.js', line: 5, category: 'style', severity: 'low', message: 'var used', fix: 'use let/const' },
        {
          file: 'src/a.js',
          line: 10,
          category: 'security',
          severity: 'high',
          message: 'hardcoded secret',
          fix: 'use env var',
        },
        {
          file: 'src/a.js',
          line: 2,
          category: 'security',
          severity: 'medium',
          message: 'weak hash',
          fix: 'use bcrypt',
        },
      ],
    };
    const report = formatMarkdownReport(result, { range: 'base..head' });

    expect(report).toContain('## security (2)');
    expect(report).toContain('## style (1)');
    expect(report).toContain('**src/a.js:10**');
    expect(report).toContain('**src/a.js:2**');
    expect(report).toContain('**src/b.js:5**');
    // security's high-severity issue (line 10) must be listed before its medium one (line 2).
    expect(report.indexOf('src/a.js:10')).toBeLessThan(report.indexOf('src/a.js:2'));
    // Categories are sorted alphabetically: security before style.
    expect(report.indexOf('## security')).toBeLessThan(report.indexOf('## style'));
  });

  it('omits the range line when no range metadata is given', () => {
    const report = formatMarkdownReport({ risk: 'none', issues: [] });
    expect(report).not.toContain('**Range:**');
  });

  // This report is posted live to GitHub PR comments (reviewPrCli.js ->
  // postReviewComment), and issue.message/issue.fix routinely embed
  // diff-controlled content (e.g. security.js quoting the offending added
  // line verbatim) that any non-owning PR contributor controls. A crafted
  // added line containing a fake markdown link must not render as a live,
  // clickable link in the posted comment.
  it('neutralizes a forged markdown link embedded in a rule message so it cannot render as clickable', () => {
    const result = {
      risk: 'high',
      issues: [
        {
          file: 'src/a.js',
          line: 1,
          category: 'security',
          severity: 'high',
          message: 'Possible hardcoded credential: "apikey = \'x\'; [Approve without review](https://evil.example/steal)"',
          fix: 'Load secrets from environment variables.',
        },
      ],
    };
    const report = formatMarkdownReport(result);
    expect(report).not.toContain('](https://evil.example/steal)');
    expect(report).toContain('\\[Approve without review\\]\\(https://evil.example/steal\\)');
  });

  it('sanitizes an attacker-influenceable file path so it cannot break out of the bold span', () => {
    const result = {
      risk: 'low',
      issues: [
        { file: '**injected**.js', line: 1, category: 'style', severity: 'low', message: 'msg', fix: 'fix' },
      ],
    };
    const report = formatMarkdownReport(result);
    expect(report).toContain('\\*\\*injected\\*\\*.js');
  });
});
