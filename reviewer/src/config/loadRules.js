const defaultRules = require('../rules');
const { loadRuleConfig, DEFAULT_CONFIG_PATH } = require('./loadRuleConfig');
const { buildRules } = require('./buildRules');

// Reads review-rules.yaml (or the given path) and returns a ready-to-use
// rules array for reviewDiff(diffText, rules).
function loadRules(configPath = DEFAULT_CONFIG_PATH, baseRules = defaultRules) {
  const config = loadRuleConfig(configPath);
  return buildRules(config, baseRules);
}

module.exports = { loadRules, loadRuleConfig, buildRules, DEFAULT_CONFIG_PATH };
