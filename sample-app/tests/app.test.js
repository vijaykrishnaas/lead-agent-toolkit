const request = require('supertest');
const { createApp } = require('../src/app');

describe('App', () => {
  test('GET /health returns ok', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('unknown route returns 404', async () => {
    const app = createApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });

  test('malformed JSON body returns 400, not 500', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON body' });
  });

  test('oversized JSON body returns 413, not 500', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
  });
});
