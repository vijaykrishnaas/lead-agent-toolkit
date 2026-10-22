const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// reviewer/src/config -> reviewer/src -> reviewer -> repo root.
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'review-rules.yaml');
const VALID_SEVERITIES = ['low', 'medium', 'high'];

// An invalid value still falls back to the permissive default (rule on, "low"),
// but is reported so a typo does not silently loosen the rule.
function normalizeCategoryConfig(category, raw, warn) {
  const isMapping = raw && typeof raw === 'object' && !Array.isArray(raw);
  // An empty entry (`style:`) is fine; a scalar/list is a likely mistake such as `style: false`.
  if (raw !== undefined && raw !== null && !isMapping) {
    warn(`review-rules: settings for ${category} must be a mapping (${JSON.stringify(raw)} given); use "enabled: false" to disable a rule, defaults apply`);
  }
  const source = isMapping ? raw : {};
  if (source.enabled !== undefined && typeof source.enabled !== 'boolean') {
    warn(`review-rules: invalid "enabled" for ${category} (${JSON.stringify(source.enabled)}); expected true/false, rule stays enabled`);
  }
  if (source.minSeverity !== undefined && !VALID_SEVERITIES.includes(source.minSeverity)) {
    warn(`review-rules: invalid "minSeverity" for ${category} (${JSON.stringify(source.minSeverity)}); expected ${VALID_SEVERITIES.join('/')}, using "low"`);
  }
  const enabled = source.enabled !== false;
  const minSeverity = VALID_SEVERITIES.includes(source.minSeverity) ? source.minSeverity : 'low';
  const optionsOk = source.options && typeof source.options === 'object' && !Array.isArray(source.options);
  if (source.options !== undefined && source.options !== null && !optionsOk) {
    warn(`review-rules: invalid "options" for ${category}; expected a mapping, using no options`);
  }
  const options = optionsOk ? source.options : {};
  return { enabled, minSeverity, options };
}

// Missing config file -> all rules run with defaults (matches reviewDiff's
// own behavior when no config is supplied at all). A malformed file is a
// real error and is not swallowed.
// `knownCategories`, when given, lets a misspelled category name be reported
// instead of silently leaving the intended rule at its defaults.
function loadRuleConfig(configPath = DEFAULT_CONFIG_PATH, { warn = console.warn, knownCategories } = {}) {
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

  const rulesValue = parsed && parsed.rules;
  const isMapping = typeof rulesValue === 'object' && rulesValue !== null && !Array.isArray(rulesValue);
  if (rulesValue !== undefined && rulesValue !== null && !isMapping) {
    warn('review-rules: "rules" must be a mapping of category -> settings; ignoring it, all rules stay enabled');
  }
  const rawRules = isMapping ? rulesValue : {};
  const rules = {};
  for (const category of Object.keys(rawRules)) {
    if (knownCategories && !knownCategories.includes(category)) {
      warn(`review-rules: unknown category "${category}"; known categories: ${knownCategories.join(', ')}`);
    }
    rules[category] = normalizeCategoryConfig(category, rawRules[category], warn);
  }
  return { rules };
}

module.exports = { loadRuleConfig, DEFAULT_CONFIG_PATH };
