const DEV_SECRET = 'dev-secret';
const PLACEHOLDER_SECRET = 'change-me'; // matches JWT_SECRET in .env.example

// Resolves the JWT signing/verification secret. In production, refuses to
// fall back to the dev default or the .env.example placeholder — both are
// public (checked into this repo / this file), so honoring either in
// production would let anyone forge valid tokens.
function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret === PLACEHOLDER_SECRET || secret === DEV_SECRET) {
      throw new Error(
        'JWT_SECRET must be set to a real secret in production (it is currently unset or still a known default/placeholder value).'
      );
    }
    return secret;
  }
  return secret || DEV_SECRET;
}

module.exports = { resolveJwtSecret, DEV_SECRET, PLACEHOLDER_SECRET };
