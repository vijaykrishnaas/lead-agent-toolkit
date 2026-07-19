const jwt = require('jsonwebtoken');
const { resolveJwtSecret } = require('../config/jwtSecret');

function auth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  // Resolved outside the try/catch: a misconfigured secret is a server
  // error (500 via the app's error middleware), not an invalid-token 401.
  const secret = resolveJwtSecret();
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    req.user = { id: payload.id, email: payload.email };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = auth;
