#!/usr/bin/env node
// Mirrors .claude/skills/* into plugin/skills/* so the two never drift.
// Skills are edited only under .claude/skills/ (see README.md); this script
// is the only thing that should ever write into plugin/skills/.
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, '.claude', 'skills');
const DEST_DIR = path.join(REPO_ROOT, 'plugin', 'skills');

function mirrorDir(sourceDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

  for (const entry of sourceEntries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      mirrorDir(sourcePath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destPath);
    }
  }

  for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (!sourceNames.has(entry.name)) {
      fs.rmSync(path.join(destDir, entry.name), { recursive: true, force: true });
    }
  }
}

function syncPlugin({ sourceDir = SOURCE_DIR, destDir = DEST_DIR } = {}) {
  mirrorDir(sourceDir, destDir);
}

if (require.main === module) {
  syncPlugin();
  console.log(
    `Synced skills from ${path.relative(REPO_ROOT, SOURCE_DIR)} to ${path.relative(REPO_ROOT, DEST_DIR)}`
  );
}

module.exports = { syncPlugin, mirrorDir, SOURCE_DIR, DEST_DIR };
