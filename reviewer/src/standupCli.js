const fs = require('fs');
const { generateStandup } = require('./standup/generateStandup');
const { tokenFromEnv } = require('./github/postReviewComment');
const { parseArgv } = require('./utils/parseArgv');

const USAGE = 'Usage: standup [--owner <owner>] [--gh-repo <name>] [--repo <path>] '
  + '[--since <iso-date>] [--token <token>] [--out <file>]';

// Value-taking flags error loudly when their value is absent (shared parseArgv;
// an unnoticed missing value for --owner previously produced a commits-only
// report with no error at all — see the CLAUDE.md guideline on value flags).
const ARG_SPEC = {
  flags: {
    '--owner': { key: 'owner' },
    '--gh-repo': { key: 'ghRepo' },
    '--repo': { key: 'repo' },
    '--since': { key: 'since' },
    '--token': { key: 'token' },
    '--out': { key: 'out' },
  },
};

function parseStandupArgs(argv) {
  const args = parseArgv(argv, {
    ...ARG_SPEC,
    defaults: {
      owner: null, ghRepo: null, repo: process.cwd(), since: null, token: null, out: null,
    },
  });
  if ((args.owner && !args.ghRepo) || (!args.owner && args.ghRepo)) {
    throw new Error('--owner and --gh-repo must both be given (or both omitted) to include pull requests.');
  }
  return args;
}

// deps are injectable so tests never shell out to real git, hit the real
// GitHub API, or touch the filesystem. Every pipeline stage is individually
// try/catch guarded (per CLAUDE.md's runCli-style-entry-point guideline) so
// an unexpected throw from any stage still returns a clean exit code plus a
// stderr message instead of a raw crash.
async function runStandupCli(argv, deps = {}) {
  const generateStandupFn = deps.generateStandup || generateStandup;
  const tokenFromEnvFn = deps.tokenFromEnv || tokenFromEnv;
  const env = deps.env || process.env;
  const writeFile = deps.writeFile || ((filePath, content) => fs.writeFileSync(filePath, content));
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;

  let args;
  try {
    args = parseStandupArgs(argv);
  } catch (err) {
    stderr.write(`${err.message}\n${USAGE}\n`);
    return 1;
  }

  let report;
  try {
    const token = args.token || tokenFromEnvFn(env);
    report = await generateStandupFn({
      repo: args.repo,
      owner: args.owner,
      ghRepo: args.ghRepo,
      since: args.since || undefined,
    }, { ...deps, token });
  } catch (err) {
    stderr.write(`Failed to generate standup report: ${err.message}\n`);
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
  runStandupCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { runStandupCli, parseStandupArgs };
