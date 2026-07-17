const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// reviewer/src/config -> reviewer/src -> reviewer -> repo root.
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'review-rules.yaml');
const VALID_SEVERITIES = ['low', 'medium', 'high'];

function normalizeCategoryConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const enabled = source.enabled !== false;
  const minSeverity = VALID_SEVERITIES.includes(source.minSeverity) ? source.minSeverity : 'low';
  const options = source.options && typeof source.options === 'object' ? source.options : {};
  return { enabled, minSeverity, options };
}

// Missing config file -> all rules run with defaults (matches reviewDiff's
// own behavior when no config is supplied at all). A malformed file is a
// real error and is not swallowed.
function loadRuleConfig(configPath = DEFAULT_CONFIG_PATH) {
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      parsed = {};
    } else {
      throw err;
    }
  }

  const rawRules = parsed && typeof parsed.rules === 'object' && parsed.rules !== null ? parsed.rules : {};
  const rules = {};
  for (const category of Object.keys(rawRules)) {
    rules[category] = normalizeCategoryConfig(rawRules[category]);
  }
  return { rules };
}

module.exports = { loadRuleConfig, DEFAULT_CONFIG_PATH };
