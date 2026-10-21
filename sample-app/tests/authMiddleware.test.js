const jwt = require('jsonwebtoken');
const auth = require('../src/middleware/auth');

function run(header) {
  const req = { header: (name) => (name === 'Authorization' ? header : undefined) };
  const res = { statusCode: null, status(code) { this.statusCode = code; return this; }, json() { return this; } };
  const next = jest.fn();
  auth(req, res, next);
  return { req, res, next };
}

describe('auth middleware', () => {
  const tok = jwt.sign({ id: 'u1', email: 'a@b.com' }, process.env.JWT_SECRET || 'dev-secret');

  it('accepts the Bearer scheme case-insensitively (RFC 7235)', () => {
    for (const scheme of ['bearer', 'BEARER', 'BeArEr']) {
      const { req, next, res } = run(`${scheme} ${tok}`);
      expect(res.statusCode).toBeNull();
      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual({ id: 'u1', email: 'a@b.com' });
    }
  });

  it('still rejects a non-Bearer scheme', () => {
    const { res, next } = run(`Basic ${tok}`);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
