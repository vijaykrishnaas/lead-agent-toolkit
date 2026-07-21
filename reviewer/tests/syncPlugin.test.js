const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncPlugin } = require('../../scripts/syncPlugin');

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sync-plugin-test-'));
}

function writeFile(root, relPath, content) {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('syncPlugin', () => {
  let sourceDir;
  let destDir;

  beforeEach(() => {
    sourceDir = mkTempDir();
    destDir = mkTempDir();
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('copies a skill file into a destination that does not yet exist', () => {
    writeFile(sourceDir, 'review-pr/SKILL.md', 'review-pr content');

    syncPlugin({ sourceDir, destDir });

    expect(fs.readFileSync(path.join(destDir, 'review-pr', 'SKILL.md'), 'utf8')).toBe('review-pr content');
  });

  it('copies multiple skill directories', () => {
    writeFile(sourceDir, 'review-pr/SKILL.md', 'review-pr content');
    writeFile(sourceDir, 'standup/SKILL.md', 'standup content');

    syncPlugin({ sourceDir, destDir });

    expect(fs.readFileSync(path.join(destDir, 'review-pr', 'SKILL.md'), 'utf8')).toBe('review-pr content');
    expect(fs.readFileSync(path.join(destDir, 'standup', 'SKILL.md'), 'utf8')).toBe('standup content');
  });

  it('overwrites a stale destination copy with the current source content', () => {
    writeFile(sourceDir, 'review-pr/SKILL.md', 'updated content');
    writeFile(destDir, 'review-pr/SKILL.md', 'stale content');

    syncPlugin({ sourceDir, destDir });

    expect(fs.readFileSync(path.join(destDir, 'review-pr', 'SKILL.md'), 'utf8')).toBe('updated content');
  });

  it('removes a destination file that no longer exists in the source', () => {
    writeFile(sourceDir, 'review-pr/SKILL.md', 'review-pr content');
    writeFile(destDir, 'review-pr/SKILL.md', 'review-pr content');
    writeFile(destDir, 'review-pr/STALE.md', 'leftover file');

    syncPlugin({ sourceDir, destDir });

    expect(fs.existsSync(path.join(destDir, 'review-pr', 'STALE.md'))).toBe(false);
  });

  it('removes an entire destination skill directory that no longer exists in the source', () => {
    writeFile(sourceDir, 'review-pr/SKILL.md', 'review-pr content');
    writeFile(destDir, 'review-pr/SKILL.md', 'review-pr content');
    writeFile(destDir, 'retired-skill/SKILL.md', 'no longer a real skill');

    syncPlugin({ sourceDir, destDir });

    expect(fs.existsSync(path.join(destDir, 'retired-skill'))).toBe(false);
  });

  it('mirrors nested subdirectories inside a skill directory', () => {
    writeFile(sourceDir, 'doc-drift/SKILL.md', 'doc-drift content');
    writeFile(sourceDir, 'doc-drift/references/notes.md', 'reference notes');

    syncPlugin({ sourceDir, destDir });

    expect(fs.readFileSync(path.join(destDir, 'doc-drift', 'references', 'notes.md'), 'utf8')).toBe(
      'reference notes'
    );
  });

  it('is idempotent: running it twice in a row leaves the destination unchanged', () => {
    writeFile(sourceDir, 'review-pr/SKILL.md', 'review-pr content');

    syncPlugin({ sourceDir, destDir });
    const firstRunContent = fs.readFileSync(path.join(destDir, 'review-pr', 'SKILL.md'), 'utf8');
    syncPlugin({ sourceDir, destDir });
    const secondRunContent = fs.readFileSync(path.join(destDir, 'review-pr', 'SKILL.md'), 'utf8');

    expect(secondRunContent).toBe(firstRunContent);
  });

  it('creates the destination root directory when it does not exist yet', () => {
    fs.rmSync(destDir, { recursive: true, force: true });
    writeFile(sourceDir, 'review-pr/SKILL.md', 'review-pr content');

    expect(() => syncPlugin({ sourceDir, destDir })).not.toThrow();
    expect(fs.readFileSync(path.join(destDir, 'review-pr', 'SKILL.md'), 'utf8')).toBe('review-pr content');
  });
});

describe('syncPlugin against the real repo skill directories', () => {
  it('produces a plugin/skills/ tree that is byte-identical to .claude/skills/ (the state plugin.test.js guards)', () => {
    const REPO_ROOT = path.join(__dirname, '..', '..');
    const REAL_SOURCE = path.join(REPO_ROOT, '.claude', 'skills');
    const scratchDest = mkTempDir();
    try {
      syncPlugin({ sourceDir: REAL_SOURCE, destDir: scratchDest });

      const skillNames = fs
        .readdirSync(REAL_SOURCE, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      for (const name of skillNames) {
        const synced = fs.readFileSync(path.join(scratchDest, name, 'SKILL.md'), 'utf8');
        const committed = fs.readFileSync(path.join(REPO_ROOT, 'plugin', 'skills', name, 'SKILL.md'), 'utf8');
        expect(synced).toBe(committed);
      }
    } finally {
      fs.rmSync(scratchDest, { recursive: true, force: true });
    }
  });
});
