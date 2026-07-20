jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const User = require('../src/models/User');

function token(id, email) {
  return jwt.sign({ id, email }, process.env.JWT_SECRET || 'dev-secret');
}

describe('Users', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  test('rejects requests without a token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  test('GET /me returns the current user', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', name: 'Bob', email: 'bob@example.com' });
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bob');
  });

  test('GET /me 404s when the user no longer exists', async () => {
    User.findById.mockResolvedValue(null);
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(404);
  });

  test('GET /:id returns the caller\'s own profile', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', name: 'Bob', email: 'bob@example.com' });
    const res = await request(app).get('/api/users/u1').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bob');
  });

  test('GET /:id forbids viewing another user', async () => {
    const res = await request(app).get('/api/users/u2').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(403);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('PUT /:id updates the caller\'s own profile', async () => {
    User.findByIdAndUpdate.mockResolvedValue({ _id: 'u1', name: 'Bobby', email: 'bob@example.com' });
    const res = await request(app)
      .put('/api/users/u1')
      .set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`)
      .send({ name: 'Bobby' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bobby');
  });

  test('PUT /:id only ever writes the name/email fields, even when the request body sends more', async () => {
    // Regression guard: the response-only assertions above would still pass
    // if a future edit widened the $set payload to `{ ...req.body }` and
    // reopened mass assignment (e.g. an attacker-supplied `password` or
    // future `role`/`isAdmin` field), since findByIdAndUpdate is mocked and
    // its return value doesn't depend on what it was actually called with.
    // Asserting the call args is the same pattern tasksController's own
    // update tests already use as a deliberate regression guard.
    User.findByIdAndUpdate.mockResolvedValue({ _id: 'u1', name: 'Bobby', email: 'bob@example.com' });
    await request(app)
      .put('/api/users/u1')
      .set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`)
      .send({ name: 'Bobby', password: 'attacker-controlled', role: 'admin' });

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { $set: { name: 'Bobby' } },
      { new: true, runValidators: true },
    );
  });

  test('PUT /:id returns 409 (not 500) when the new email collides with another user', async () => {
    const dupErr = new Error('E11000 duplicate key error');
    dupErr.code = 11000;
    User.findByIdAndUpdate.mockRejectedValue(dupErr);
    const res = await request(app)
      .put('/api/users/u1')
      .set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`)
      .send({ email: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  test('PUT /:id forbids editing another user', async () => {
    const res = await request(app)
      .put('/api/users/u2')
      .set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  test('DELETE /:id removes the caller\'s own profile', async () => {
    User.findByIdAndDelete.mockResolvedValue({ _id: 'u1' });
    const res = await request(app).delete('/api/users/u1').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(204);
  });

  test('DELETE /:id forbids deleting another user', async () => {
    const res = await request(app).delete('/api/users/u2').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(403);
  });

  test('GET /:id returns 400 for a malformed id instead of hanging', async () => {
    const castErr = new Error('Cast to ObjectId failed');
    castErr.name = 'CastError';
    User.findById.mockRejectedValue(castErr);
    const res = await request(app).get('/api/users/not-a-valid-id').set('Authorization', `Bearer ${token('not-a-valid-id', 'bob@example.com')}`);
    expect(res.status).toBe(400);
  });

  test('GET /me returns 500 instead of hanging when the database call fails', async () => {
    User.findById.mockRejectedValue(new Error('connection lost'));
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(500);
  });

  describe('production JWT_SECRET hardening', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;
    const validToken = token('u1', 'bob@example.com');

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = originalSecret;
      }
    });

    test('rejects a request with 500 (not 401) when JWT_SECRET is unset in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${validToken}`);
      expect(res.status).toBe(500);
      expect(User.findById).not.toHaveBeenCalled();
    });

    test('rejects a request with 500 (not 401) when JWT_SECRET is still the .env.example placeholder in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'change-me';
      const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${validToken}`);
      expect(res.status).toBe(500);
      expect(User.findById).not.toHaveBeenCalled();
    });
  });
});
