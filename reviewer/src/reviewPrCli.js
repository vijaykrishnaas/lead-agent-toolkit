const fs = require('fs');
const { execFileSync } = require('child_process');
const { reviewDiff } = require('./reviewer');
const { loadRules, DEFAULT_CONFIG_PATH } = require('./config/loadRules');
const { formatMarkdownReport } = require('./format/markdownReport');
const { postReviewComment, tokenFromEnv } = require('./github/postReviewComment');
const { consumeFlagValue } = require('./utils/consumeFlagValue');

const USAGE = 'Usage: review-pr -- --owner <owner> --gh-repo <name> --pr <number> <base>..<head> '
  + '[--repo <path>] [--config <path>] [--token <token>] [--out <file>] [--no-post]';
const RANGE_PATTERN = /^(.+?)\.\.(.+)$/;

// Flags that take a following value. A flag given as the last token in argv,
// or immediately followed by another flag, must fail loudly rather than
// silently taking a wrong value — see the CLAUDE.md guideline on
// value-taking CLI flags.
const VALUE_FLAGS = {
  '--owner': 'owner', '--gh-repo': 'ghRepo', '--pr': 'pr', '--repo': 'repo', '--config': 'config', '--token': 'token', '--out': 'out',
};

function parseReviewPrArgs(argv) {
  const args = {
    owner: null, ghRepo: null, pr: null, range: null,
    repo: process.cwd(), config: undefined, token: null, out: null, noPost: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = VALUE_FLAGS[arg];
    if (key) {
      args[key] = consumeFlagValue(argv, ++i, arg);
    } else if (arg === '--no-post') {
      args.noPost = true;
    } else if (!args.range && !arg.startsWith('--')) {
      args.range = arg;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  if (!args.owner) throw new Error('Missing required --owner <owner>.');
  if (!args.ghRepo) throw new Error('Missing required --gh-repo <name>.');
  if (!args.pr) throw new Error('Missing required --pr <number>.');
  if (!/^\d+$/.test(args.pr)) throw new Error(`Invalid --pr "${args.pr}" — expected a plain number.`);
  if (!args.range) throw new Error('Missing <base>..<head> range.');
  if (!RANGE_PATTERN.test(args.range)) {
    throw new Error(`Invalid range "${args.range}" — expected <base>..<head>.`);
  }
  return args;
}

// deps are injectable so tests never shell out to real git, hit the real GitHub
// API, or touch the filesystem. Every pipeline stage is individually try/catch
// guarded (per CLAUDE.md's runCli-style-entry-point guideline) so an unexpected
// throw from any stage still returns a clean exit code plus a stderr message.
async function runReviewPrCli(argv, deps = {}) {
  const execGit = deps.execGit || ((gitArgs, cwd) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }));
  const loadRulesFn = deps.loadRules || loadRules;
  const reviewDiffFn = deps.reviewDiff || reviewDiff;
  const formatReport = deps.formatMarkdownReport || formatMarkdownReport;
  const postReviewCommentFn = deps.postReviewComment || postReviewComment;
  const tokenFromEnvFn = deps.tokenFromEnv || tokenFromEnv;
  const env = deps.env || process.env;
  const writeFile = deps.writeFile || ((filePath, content) => fs.writeFileSync(filePath, content));
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;

  let args;
  try {
    args = parseReviewPrArgs(argv);
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

  // Best-effort: lets reviewDiff resolve each file's post-image content for
  // AST-capable rules; falls back to the diff-only text/regex path on any
  // failure (see cli.js for the same pattern).
  let reviewOptions = {};
  try {
    const head = RANGE_PATTERN.exec(args.range)[2];
    const headSha = execGit(['rev-parse', head], args.repo).trim();
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

  if (args.noPost) {
    return 0;
  }

  try {
    const token = args.token || tokenFromEnvFn(env);
    const result = await postReviewCommentFn({
      token,
      owner: args.owner,
      repo: args.ghRepo,
      prNumber: args.pr,
      body: report,
    }, deps);
    const action = result && result.updated ? 'Updated existing review comment on' : 'Posted review comment to';
    stdout.write(`${action} ${args.owner}/${args.ghRepo}#${args.pr}.\n`);
  } catch (err) {
    stderr.write(`Failed to post PR comment: ${err.message}\n`);
    return 1;
  }

  return 0;
}

if (require.main === module) {
  runReviewPrCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { runReviewPrCli, parseReviewPrArgs };
