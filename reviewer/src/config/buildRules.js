const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const DEFAULT_CATEGORY_CONFIG = { enabled: true, minSeverity: 'low', options: {} };

function getCategoryConfig(config, category) {
  return (config && config.rules && config.rules[category]) || DEFAULT_CATEGORY_CONFIG;
}

// Applies a normalized rule config (see loadRuleConfig) on top of a base set
// of rule modules: drops disabled categories, filters out issues below a
// category's minSeverity, and forwards category-specific options as the
// rule's second check() argument (rules that ignore a second argument are
// unaffected).
function buildRules(config, baseRules) {
  const rules = [];
  for (const rule of baseRules) {
    const categoryConfig = getCategoryConfig(config, rule.category);
    if (!categoryConfig.enabled) continue;

    const minRank = SEVERITY_RANK[categoryConfig.minSeverity] || SEVERITY_RANK.low;
    rules.push({
      category: rule.category,
      check(files) {
        const issues = rule.check(files, categoryConfig.options) || [];
        return issues.filter((issue) => (SEVERITY_RANK[issue.severity] || SEVERITY_RANK.low) >= minRank);
      },
    });
  }
  return rules;
}

module.exports = { buildRules };
