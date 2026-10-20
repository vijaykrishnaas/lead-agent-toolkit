// Append-only structured log of scheduled-loop runs (runs.jsonl), one JSON object per line.
// Usage:
//   node scripts/runLog.js append --trigger builder --outcome done --task 30 --tests green --summary "..."
//   node scripts/runLog.js idle-streak   -> prints the number of trailing consecutive "noop" entries
// The idle streak drives CLAUDE.md's SCHEDULED LOOP backoff: a "paused" (or any non-noop) entry ends it.
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'runs.jsonl');
const TRIGGERS = ['builder', 'reviewer', 'manual'];
const OUTCOMES = ['done', 'noop', 'blocked', 'failed', 'paused'];
const TESTS = ['green', 'red', 'skipped'];
const VALUE_FLAGS = ['trigger', 'outcome', 'task', 'tests', 'summary', 'sha'];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--') || !VALUE_FLAGS.includes(flag.slice(2))) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    opts[flag.slice(2)] = value;
    i++;
  }
  return opts;
}

function buildEntry(opts, now = new Date()) {
  if (!TRIGGERS.includes(opts.trigger)) {
    throw new Error(`--trigger must be one of ${TRIGGERS.join(', ')}`);
  }
  if (!OUTCOMES.includes(opts.outcome)) {
    throw new Error(`--outcome must be one of ${OUTCOMES.join(', ')}`);
  }
  const tests = opts.tests || 'skipped';
  if (!TESTS.includes(tests)) {
    throw new Error(`--tests must be one of ${TESTS.join(', ')}`);
  }
  if (!opts.summary || !opts.summary.trim()) {
    throw new Error('--summary is required');
  }
  return {
    ts: now.toISOString(),
    trigger: opts.trigger,
    outcome: opts.outcome,
    task: opts.task || null,
    tests,
    sha: opts.sha || null,
    summary: opts.summary.trim(),
  };
}

function parseLog(content) {
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`runs.jsonl line ${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

function idleStreak(entries) {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome !== 'noop') break;
    streak++;
  }
  return streak;
}

function readLog(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function main(argv, file = LOG_FILE) {
  const [command, ...rest] = argv;
  if (command === 'append') {
    const entry = buildEntry(parseArgs(rest));
    const existing = readLog(file);
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(file, `${prefix}${JSON.stringify(entry)}\n`);
    return JSON.stringify(entry);
  }
  if (command === 'idle-streak') {
    return String(idleStreak(parseLog(readLog(file))));
  }
  throw new Error('Usage: node scripts/runLog.js <append|idle-streak> [--flag value ...]');
}

if (require.main === module) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`runLog failed: ${err.message}`);
    process.exit(2);
  }
}

module.exports = { parseArgs, buildEntry, parseLog, idleStreak, main };
