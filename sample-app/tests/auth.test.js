jest.mock('../src/models/User');

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const User = require('../src/models/User');

describe('Auth', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  test('register creates a user and returns a token', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ _id: 'user1', name: 'Alice', email: 'alice@example.com', password: 'hashed' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'secret123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toEqual({ id: 'user1', name: 'Alice', email: 'alice@example.com' });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice', email: 'alice@example.com' }));
  });

  test('register rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('register rejects a duplicate email', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(409);
  });

  test('register rejects a duplicate email lost to a concurrent request (unique-index race)', async () => {
    // Regression: the existence check and the insert are two separate,
    // non-atomic calls. A concurrent registration for the same email can
    // pass User.findOne here and only fail later, at User.create, with a
    // MongoDB duplicate-key error (code 11000) — that path used to fall
    // through to the generic catch and return a misleading 500 instead of
    // the same 409 the pre-check path returns.
    User.findOne.mockResolvedValue(null);
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    User.create.mockRejectedValue(duplicateKeyError);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@b.com', password: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('register rejects a non-string email instead of crashing into a 500', async () => {
    // Regression: `!email` only rejects falsy values, so a wrong-typed but
    // truthy email (e.g. an object from a malformed/adversarial request
    // body) reached `email.toLowerCase()` and threw a TypeError that the
    // generic catch turned into a 500, instead of the 400 every other
    // malformed-input case returns.
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: { $ne: null }, password: 'x' });
    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('login succeeds with correct credentials', async () => {
    const hashed = await bcrypt.hash('secret123', 10);
    User.findOne.mockResolvedValue({ _id: 'user1', name: 'Alice', email: 'alice@example.com', password: hashed });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('login rejects a wrong password', async () => {
    const hashed = await bcrypt.hash('secret123', 10);
    User.findOne.mockResolvedValue({ _id: 'user1', name: 'Alice', email: 'alice@example.com', password: hashed });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
  });

  test('login rejects an unknown user', async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nope@example.com', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('login rejects a non-string email instead of crashing into a 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: 'x' });
    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('login rejects an empty-string password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: '' });
    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });
});
