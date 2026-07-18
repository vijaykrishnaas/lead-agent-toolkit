const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PLUGIN_ROOT = path.join(__dirname, '..', '..', 'plugin');
const STANDALONE_SKILLS_ROOT = path.join(__dirname, '..', '..', '.claude', 'skills');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, relPath), 'utf8'));
}

function readFrontmatter(skillPath) {
  const content = fs.readFileSync(skillPath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error(`No YAML frontmatter block found in ${skillPath}`);
  }
  return yaml.load(match[1]);
}

describe('plugin.json', () => {
  const manifest = readJson('.claude-plugin/plugin.json');

  it('has the required name field, kebab-case', () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('has a description', () => {
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description.length).toBeGreaterThan(0);
  });
});

describe('marketplace.json', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const pluginManifest = readJson('.claude-plugin/plugin.json');

  it('has the required name, owner, and plugins fields', () => {
    expect(marketplace.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(marketplace.owner).toHaveProperty('name');
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins.length).toBeGreaterThan(0);
  });

  it('lists the plugin with a source resolving to the plugin root', () => {
    const entry = marketplace.plugins.find((p) => p.name === pluginManifest.name);
    expect(entry).toBeDefined();
    expect(entry.source).toBe('./');
  });
});

describe('plugin skills', () => {
  const skillNames = fs
    .readdirSync(STANDALONE_SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it('found at least one standalone skill to check parity against', () => {
    expect(skillNames.length).toBeGreaterThan(0);
  });

  it.each(skillNames)('%s/SKILL.md exists under the plugin skills/ directory', (name) => {
    const skillPath = path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it.each(skillNames)('%s/SKILL.md has valid YAML frontmatter with name and description', (name) => {
    const skillPath = path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md');
    const frontmatter = readFrontmatter(skillPath);
    expect(frontmatter.name).toBe(name);
    expect(typeof frontmatter.description).toBe('string');
    expect(frontmatter.description.length).toBeGreaterThan(0);
  });

  it.each(skillNames)('%s/SKILL.md is byte-identical to its standalone .claude/skills/ copy', (name) => {
    const pluginCopy = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    const standaloneCopy = fs.readFileSync(path.join(STANDALONE_SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
    expect(pluginCopy).toBe(standaloneCopy);
  });
});
