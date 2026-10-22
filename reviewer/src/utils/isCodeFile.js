// Code-pattern rules (errorHandling, performance, style) match JS syntax with
// regexes; on markdown/YAML/JSON diff lines they flag prose that merely
// mentions `.then(` or `console.log(`. Gate them on a JS/TS extension.
function isCodeFile(path) {
  return /\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(path || '');
}

module.exports = { isCodeFile };
