const fs = require('fs');
const path = require('path');

// Regression coverage for doc/prose drift inside this repo's own README.md
// and plugin/.claude-plugin/*.json manifests — the post-task-14 hunt found
// three separate instances of exactly this drift shape in one run (a stale
// hardcoded Jest test count, a "not yet built" claim for a shipped feature,
// and a marketplace description missing a just-added skill), all caught
// only by manual inspection. Skill names are enumerated from plugin/skills/
// (like plugin.test.js/skillsFrontmatter.test.js already do for skill
// parity), not hardcoded, so a future skill is covered automatically.
const REPO_ROOT = path.join(__dirname, '..', '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugin');
const PLUGIN_SKILLS_ROOT = path.join(PLUGIN_ROOT, 'skills');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, relPath), 'utf8'));
}

function nameTokens(skillName) {
  return skillName.split('-').filter(Boolean);
}

// A "mention" is every hyphen-separated token of the skill's name appearing
// as a whole word somewhere in the text, case-insensitively — loose enough
// to allow prose like "PR review" for the review-pr skill, but still catches
// a skill missing from a description entirely (the post-task-14 bug this
// guards). Word-boundary (not raw substring) matching: a raw-substring check
// let short tokens like "pr" false-match inside unrelated words (e.g.
// "Express"), and "review" false-match inside "reviewer" (this repo's own
// package name, present in most descriptions) — verified that stripping
// every literal "review-pr"/"PR review" mention from README.md still left
// the substring check passing, a false pass a word-boundary check catches.
function mentionsSkill(text, skillName) {
  return nameTokens(skillName).every((token) => new RegExp(`\\b${token}\\b`, 'i').test(text));
}

const skillNames = fs
  .readdirSync(PLUGIN_SKILLS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

describe('README.md / plugin manifest doc-prose drift guards', () => {
  it('found at least one packaged skill to check descriptions against', () => {
    expect(skillNames.length).toBeGreaterThan(0);
  });

  it.each(skillNames)("plugin.json's description mentions the %s skill", (name) => {
    const manifest = readJson('.claude-plugin/plugin.json');
    expect(mentionsSkill(manifest.description, name)).toBe(true);
  });

  it.each(skillNames)("marketplace.json's top-level description mentions the %s skill", (name) => {
    const marketplace = readJson('.claude-plugin/marketplace.json');
    expect(mentionsSkill(marketplace.description, name)).toBe(true);
  });

  it.each(skillNames)("marketplace.json's plugin-entry description mentions the %s skill", (name) => {
    const marketplace = readJson('.claude-plugin/marketplace.json');
    const pluginManifest = readJson('.claude-plugin/plugin.json');
    const entry = marketplace.plugins.find((p) => p.name === pluginManifest.name);
    expect(entry).toBeDefined();
    expect(mentionsSkill(entry.description, name)).toBe(true);
  });

  it.each(skillNames)('README.md mentions the %s skill', (name) => {
    expect(mentionsSkill(readme, name)).toBe(true);
  });

  it('README.md does not hardcode a Jest test count that will drift as tests are added', () => {
    expect(readme).not.toMatch(/\d+\+?\s+Jest/i);
  });

  it("mentionsSkill does not false-pass on short tokens substring-matching unrelated words", () => {
    // "pr" is a substring of "Express"/"approach"/etc., and "review" is a
    // substring of "reviewer" (this repo's own package name) — a raw
    // substring check would report review-pr as "mentioned" even in text
    // that never actually mentions it. Reproduces the exact false pass
    // found by stripping every literal review-pr/PR review mention from
    // README.md while leaving "Express" and "reviewer" in place.
    expect(mentionsSkill('Built with Express and this repo\'s reviewer/ toolkit.', 'review-pr')).toBe(false);
  });
});
