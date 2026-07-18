const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Scans every standalone .claude/skills/*/SKILL.md file (not just the ones
// currently copied into plugin/, which plugin.test.js already covers) and
// asserts each one's YAML frontmatter actually parses and has name/
// description. An unquoted `[...]`-shaped argument-hint (or any other
// invalid-YAML frontmatter) silently drops all frontmatter fields at
// runtime with no error — this shipped twice (review-pr, standup) before
// being caught, purely by luck, only once anything ran `claude plugin
// validate` against the two skills already copied into plugin/. doc-drift
// (task 12) was never copied into plugin/, so nothing in this suite ever
// parsed its frontmatter at all until this file was added — generalizing
// the check here means any future standalone skill is covered
// automatically, without needing its own copy in plugin/ first.
const SKILLS_ROOT = path.join(__dirname, '..', '..', '.claude', 'skills');

function readFrontmatter(skillPath) {
  const content = fs.readFileSync(skillPath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error(`No YAML frontmatter block found in ${skillPath}`);
  }
  return yaml.load(match[1]);
}

const skillNames = fs
  .readdirSync(SKILLS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('.claude/skills/*/SKILL.md frontmatter', () => {
  it('found at least one skill directory to check', () => {
    expect(skillNames.length).toBeGreaterThan(0);
  });

  it.each(skillNames)('%s/SKILL.md has valid YAML frontmatter with name and description', (name) => {
    const skillPath = path.join(SKILLS_ROOT, name, 'SKILL.md');
    const frontmatter = readFrontmatter(skillPath);
    expect(frontmatter.name).toBe(name);
    expect(typeof frontmatter.description).toBe('string');
    expect(frontmatter.description.length).toBeGreaterThan(0);
  });
});
