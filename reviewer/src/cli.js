const fs = require('fs');
const { execFileSync } = require('child_process');
const { reviewDiff } = require('./reviewer');
const { loadRules, DEFAULT_CONFIG_PATH } = require('./config/loadRules');
const { formatMarkdownReport } = require('./format/markdownReport');

const USAGE = 'Usage: review -- <base>..<head> [--repo <path>] [--config <path>] [--out <file>]';
const RANGE_PATTERN = /^(.+?)\.\.(.+)$/;

function parseArgs(argv) {
  const args = { range: null, repo: process.cwd(), config: undefined, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      args.repo = argv[++i];
    } else if (arg === '--config') {
      args.config = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (!args.range && !arg.startsWith('--')) {
      args.range = arg;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  if (!args.range) throw new Error('Missing <base>..<head> range.');
  const match = RANGE_PATTERN.exec(args.range);
  if (!match) throw new Error(`Invalid range "${args.range}" — expected <base>..<head>.`);
  args.base = match[1];
  args.head = match[2];
  return args;
}

// deps are injectable so tests can avoid shelling out to real git / hitting the real
// filesystem for config and output.
function runCli(argv, deps = {}) {
  const execGit = deps.execGit || ((gitArgs, cwd) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }));
  const loadRulesFn = deps.loadRules || loadRules;
  const reviewDiffFn = deps.reviewDiff || reviewDiff;
  const formatReport = deps.formatMarkdownReport || formatMarkdownReport;
  const writeFile = deps.writeFile || ((path, content) => fs.writeFileSync(path, content));
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`${err.message}\n${USAGE}\n`);
    return 1;
  }

  let diffText;
  try {
    diffText = execGit(['diff', args.range], args.repo);
  } catch (err) {
    stderr.write(`git diff failed: ${err.message}\n`);
    return 1;
  }

  let rules;
  try {
    rules = loadRulesFn(args.config === undefined ? DEFAULT_CONFIG_PATH : args.config);
  } catch (err) {
    stderr.write(`Failed to load review-rules config: ${err.message}\n`);
    return 1;
  }

  const result = reviewDiffFn(diffText, rules);
  const report = formatReport(result, { range: args.range });

  if (args.out) {
    writeFile(args.out, report);
  } else {
    stdout.write(report);
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

module.exports = { runCli, parseArgs };
