function formatRouteLine(route) {
  return `- \`${route.method} ${route.path}\``;
}

function formatUnparsedRouteLine(finding) {
  const label = finding.method ? `${finding.method} — ` : '';
  return `- \`${finding.file}:${finding.line}\` (${label}${finding.reason})`;
}

// Renders a compareRoutes() result ({ missingFromSpec, missingFromCode }),
// plus an optional unparsedRoutes list (routes/mounts with a
// template-literal path that couldn't be statically resolved -- see
// collectExpressRoutes/findUnparsedRoutes), as a markdown mismatch report.
// meta is optional context (e.g. { app: 'app.js', openapi: 'openapi.yaml' })
// shown in the header. A non-empty unparsedRoutes always earns its own
// section, even when missingFromSpec/missingFromCode are both empty --
// otherwise the report would read as "No drift detected," i.e. full,
// verified coverage, when in fact one or more routes were never checked at
// all (AUDIT.md F8).
function formatDocDriftReport(result, meta = {}) {
  const { missingFromSpec, missingFromCode, unparsedRoutes = [] } = result;
  const lines = ['# Doc Drift Report', ''];

  if (meta.app) lines.push(`**Routes source:** \`${meta.app}\``);
  if (meta.openapi) lines.push(`**OpenAPI spec:** \`${meta.openapi}\``);
  if (meta.app || meta.openapi) lines.push('');

  if (missingFromSpec.length === 0 && missingFromCode.length === 0 && unparsedRoutes.length === 0) {
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

  lines.push(`## Unparsed routes — could not be statically verified (${unparsedRoutes.length})`, '');
  if (unparsedRoutes.length === 0) {
    lines.push('_None._', '');
  } else {
    for (const finding of unparsedRoutes) lines.push(formatUnparsedRouteLine(finding));
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

module.exports = { formatDocDriftReport };
