function formatRouteLine(route) {
  return `- \`${route.method} ${route.path}\``;
}

// Renders a compareRoutes() result ({ missingFromSpec, missingFromCode }) as a
// markdown mismatch report. meta is optional context (e.g. { app: 'app.js',
// openapi: 'openapi.yaml' }) shown in the header.
function formatDocDriftReport(result, meta = {}) {
  const { missingFromSpec, missingFromCode } = result;
  const lines = ['# Doc Drift Report', ''];

  if (meta.app) lines.push(`**Routes source:** \`${meta.app}\``);
  if (meta.openapi) lines.push(`**OpenAPI spec:** \`${meta.openapi}\``);
  if (meta.app || meta.openapi) lines.push('');

  if (missingFromSpec.length === 0 && missingFromCode.length === 0) {
    lines.push('No drift detected — routes and OpenAPI spec are in sync.');
    return lines.join('\n') + '\n';
  }

  lines.push(`## Routes missing from OpenAPI spec (${missingFromSpec.length})`, '');
  if (missingFromSpec.length === 0) {
    lines.push('_None._', '');
  } else {
    for (const route of missingFromSpec) lines.push(formatRouteLine(route));
    lines.push('');
  }

  lines.push(`## OpenAPI paths missing from routes (${missingFromCode.length})`, '');
  if (missingFromCode.length === 0) {
    lines.push('_None._', '');
  } else {
    for (const route of missingFromCode) lines.push(formatRouteLine(route));
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

module.exports = { formatDocDriftReport };
