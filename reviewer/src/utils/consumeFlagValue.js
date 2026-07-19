// Reads argv[i] as the value for the value-taking flag `flagName`, throwing
// a clear "Missing value for --x" error instead of silently accepting a bad
// value in either of the two ways a caller can omit one: the flag is the
// last token in argv (value is undefined), or the flag is immediately
// followed by another flag (value looks like a flag itself, e.g.
// `--out --repo` silently taking '--repo' as --out's value and dropping
// --repo's own value entirely). Shared by cli.js, reviewPrCli.js,
// docDriftCli.js, and standupCli.js's parsers, which all had this identical
// value-consuming step duplicated four times.
function consumeFlagValue(argv, i, flagName) {
  const value = argv[i];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}.`);
  }
  return value;
}

module.exports = { consumeFlagValue };
