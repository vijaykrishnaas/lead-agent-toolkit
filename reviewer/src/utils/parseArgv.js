const { consumeFlagValue } = require('./consumeFlagValue');

// Shared declarative argv parser for the four CLIs (cli.js, reviewPrCli.js,
// standupCli.js, docDriftCli.js). Spec:
//   flags:      { '--name': { key, takesValue?, validate?(value) } }
//   defaults:   initial args object (copied)
//   positional: optional key; the first non-flag token is stored under it
//   required:   optional [{ key, message }] checked after parsing
// Value-taking flags go through consumeFlagValue, so a missing value always
// fails loudly ("Missing value for --x") in every CLI by construction.
// Boolean flags (takesValue false) set their key to true.
function parseArgv(argv, spec) {
  const args = { ...spec.defaults };
  const flags = spec.flags || {};
  let positionalSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const flag = Object.prototype.hasOwnProperty.call(flags, arg) ? flags[arg] : null;
    if (flag) {
      if (flag.takesValue === false) {
        args[flag.key] = true;
      } else {
        const value = consumeFlagValue(argv, ++i, arg);
        if (flag.validate) flag.validate(value);
        args[flag.key] = value;
      }
    } else if (spec.positional && !positionalSeen && !arg.startsWith('--')) {
      args[spec.positional] = arg;
      positionalSeen = true;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  for (const req of spec.required || []) {
    if (!args[req.key]) throw new Error(req.message);
  }
  return args;
}

module.exports = { parseArgv };
