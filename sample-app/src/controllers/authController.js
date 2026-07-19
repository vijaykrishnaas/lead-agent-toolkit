const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { resolveJwtSecret } = require('../config/jwtSecret');

function signToken(user) {
  const secret = resolveJwtSecret();
  return jwt.sign({ id: user._id, email: user.email }, secret, { expiresIn: '1d', algorithm: 'HS256' });
}

// req.body fields are attacker-controlled and only guaranteed to be JSON
// values, not strings — a wrong-typed field (e.g. `{"email": {"$ne": null}}`)
// is truthy and would otherwise reach `.toLowerCase()`/bcrypt/User.create
// and throw, which the generic catch below turns into a misleading 500
// instead of a 400.
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// bcrypt (and bcryptjs) silently truncates its input at 72 bytes — anything
// beyond that is ignored when hashing, so two different passwords that
// share the same first 72 bytes hash identically and both authenticate.
// Rejecting an over-length password at registration (instead of silently
// hashing only its first 72 bytes) keeps "the password the user set" and
// "the password that actually authenticates" the same thing.
const MAX_PASSWORD_BYTES = 72;

function isValidPassword(value) {
  return isNonEmptyString(value) && Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES;
}

// A precomputed hash for a password nobody can register (compared against
// on every login for an unknown/wrong email), so `bcrypt.compare` always
// runs — for the same ~tens-of-ms cost bcrypt's cost factor is chosen to
// have — regardless of whether the account exists. Without this, an
// unknown-email 401 returns immediately while a known-email/wrong-password
// 401 waits on a real bcrypt.compare, and that latency gap lets a remote
// attacker enumerate registered emails by timing alone.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('lead-agent-toolkit-timing-safety-dummy', 10);

async function register(req, res) {
  try {
    const { name, email, password } = req.body;
    if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: `password must be at most ${MAX_PASSWORD_BYTES} bytes` });
    }
    // Fail fast on a misconfigured production secret before any DB write —
    // otherwise User.create below persists an account that register can
    // never hand a token back for, and re-registering it just returns 409
    // forever until the secret is fixed.
    resolveJwtSecret();
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });
    const token = signToken(user);
    return res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    return res.status(500).json({ error: 'Registration failed' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    // Always run bcrypt.compare, even for an unknown email (against a fixed
    // dummy hash) — see DUMMY_PASSWORD_HASH above for why an early return
    // here would leak account existence via response timing.
    const match = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH);
    if (!user || !match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user);
    return res.status(200).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed' });
  }
}

module.exports = { register, login };
