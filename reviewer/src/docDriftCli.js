const fs = require('fs');
const { generateDocDrift } = require('./docDrift/generateDocDrift');

const USAGE = 'Usage: doc-drift --app <path-to-express-entry> --openapi <path-to-openapi.yaml> [--out <file>]';

// Flags that take a following value. A flag given as the last token in argv
// must fail loudly rather than silently taking `undefined` as its value —
// see the CLAUDE.md guideline on value-taking CLI flags.
const VALUE_FLAGS = { '--app': 'app', '--openapi': 'openapi', '--out': 'out' };

function parseDocDriftArgs(argv) {
  const args = { app: null, openapi: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = VALUE_FLAGS[arg];
    if (key) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}.`);
      args[key] = value;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  if (!args.app) throw new Error('Missing required --app <path-to-express-entry>.');
  if (!args.openapi) throw new Error('Missing required --openapi <path-to-openapi.yaml>.');
  return args;
}

// deps are injectable so tests can avoid touching the real filesystem.
function runDocDriftCli(argv, deps = {}) {
  const generateDocDriftFn = deps.generateDocDrift || generateDocDrift;
  const writeFile = deps.writeFile || ((filePath, content) => fs.writeFileSync(filePath, content));
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;

  let args;
  try {
    args = parseDocDriftArgs(argv);
  } catch (err) {
    stderr.write(`${err.message}\n${USAGE}\n`);
    return 1;
  }

  let report;
  try {
    report = generateDocDriftFn({ appEntryPath: args.app, openapiPath: args.openapi }, deps);
  } catch (err) {
    stderr.write(`Doc drift check failed: ${err.message}\n`);
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
  process.exitCode = runDocDriftCli(process.argv.slice(2));
}

module.exports = { runDocDriftCli, parseDocDriftArgs };
