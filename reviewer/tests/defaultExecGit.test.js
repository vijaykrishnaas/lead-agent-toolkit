const { defaultExecGit } = require('../src/utils/defaultExecGit');

describe('defaultExecGit', () => {
  test('returns output larger than the 1 MiB execFileSync default', () => {
    const exec = defaultExecGit(process.execPath);
    const out = exec(['-e', 'process.stdout.write("x".repeat(3 * 1024 * 1024))'], process.cwd());
    expect(out.length).toBe(3 * 1024 * 1024);
  });
});
