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

  test('GET /:id returns a user by id', async () => {
    User.findById.mockResolvedValue({ _id: 'u2', name: 'Carl', email: 'carl@example.com' });
    const res = await request(app).get('/api/users/u2').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Carl');
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
    const res = await request(app).get('/api/users/not-a-valid-id').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(400);
  });

  test('GET /me returns 500 instead of hanging when the database call fails', async () => {
    User.findById.mockRejectedValue(new Error('connection lost'));
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token('u1', 'bob@example.com')}`);
    expect(res.status).toBe(500);
  });
});
