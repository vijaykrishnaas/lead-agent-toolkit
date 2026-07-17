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
});
