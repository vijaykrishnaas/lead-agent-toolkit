const fs = require('fs');
const { execFileSync } = require('child_process');
const { reviewDiff } = require('./reviewer');
const { loadRules, DEFAULT_CONFIG_PATH } = require('./config/loadRules');
const { formatMarkdownReport } = require('./format/markdownReport');
const { consumeFlagValue } = require('./utils/consumeFlagValue');

const USAGE = 'Usage: review -- <base>..<head> [--repo <path>] [--config <path>] [--out <file>]';
const RANGE_PATTERN = /^(.+?)\.\.(.+)$/;

// Flags that take a following value. A flag given as the last token in argv,
// or immediately followed by another flag, must fail loudly rather than
// silently taking a wrong value — see the CLAUDE.md guideline on
// value-taking CLI flags.
const VALUE_FLAGS = { '--repo': 'repo', '--config': 'config', '--out': 'out' };

function parseArgs(argv) {
  const args = { range: null, repo: process.cwd(), config: undefined, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = VALUE_FLAGS[arg];
    if (key) {
      args[key] = consumeFlagValue(argv, ++i, arg);
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

  // Resolving the head sha lets reviewDiff attach each file's post-image
  // content (via `git show <sha>:<path>`) so AST-capable rules can use it.
  // This is a best-effort enhancement, not a requirement: if the ref can't
  // be resolved (e.g. a bare/shallow repo, or a ref that only exists in the
  // diff text itself), review continues without it and every rule falls
  // back to its diff-only text/regex path exactly as before.
  let reviewOptions = {};
  try {
    const headSha = execGit(['rev-parse', args.head], args.repo).trim();
    reviewOptions = { execGit, repo: args.repo, sha: headSha };
  } catch (err) {
    reviewOptions = {};
  }

  let rules;
  try {
    rules = loadRulesFn(args.config === undefined ? DEFAULT_CONFIG_PATH : args.config);
  } catch (err) {
    stderr.write(`Failed to load review-rules config: ${err.message}\n`);
    return 1;
  }

  let report;
  try {
    const result = reviewDiffFn(diffText, rules, reviewOptions);
    report = formatReport(result, { range: args.range });
  } catch (err) {
    stderr.write(`Review failed: ${err.message}\n`);
    return 1;
  }

  try {
    if (args.out) {
      writeFile(args.out, report);
    } else {
      stdout.write(report);
    }
  } catch (err) {
    stderr.write(`Failed to write report output: ${err.message}\n`);
    return 1;
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

module.exports = { runCli, parseArgs };
