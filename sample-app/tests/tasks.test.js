jest.mock('../src/models/Task');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const Task = require('../src/models/Task');

function token(id, email) {
  return jwt.sign({ id, email }, process.env.JWT_SECRET || 'dev-secret');
}

describe('Tasks', () => {
  let app;
  let auth;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    auth = `Bearer ${token('u1', 'bob@example.com')}`;
  });

  test('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  test('creates a task for the caller', async () => {
    Task.create.mockResolvedValue({ _id: 't1', title: 'Write tests', owner: 'u1' });
    const res = await request(app).post('/api/tasks').set('Authorization', auth).send({ title: 'Write tests' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Write tests');
    expect(Task.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write tests', owner: 'u1' }));
  });

  test('rejects task creation without a title', async () => {
    const res = await request(app).post('/api/tasks').set('Authorization', auth).send({});
    expect(res.status).toBe(400);
  });

  test('lists tasks scoped to the owner', async () => {
    Task.find.mockResolvedValue([{ _id: 't1', title: 'A' }, { _id: 't2', title: 'B' }]);
    const res = await request(app).get('/api/tasks').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(Task.find).toHaveBeenCalledWith({ owner: 'u1' });
  });

  test('gets a task by id, scoped to the owner', async () => {
    // Asserting the query's owner filter, not just the response body, so a
    // future change that accidentally drops owner-scoping here (an IDOR
    // letting any authenticated user read another user's task by id) would
    // fail this test even though the mocked response body looks identical.
    Task.findOne.mockResolvedValue({ _id: 't1', title: 'A' });
    const res = await request(app).get('/api/tasks/t1').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('A');
    expect(Task.findOne).toHaveBeenCalledWith({ _id: 't1', owner: 'u1' });
  });

  test('404s for a missing task', async () => {
    Task.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/tasks/missing').set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  test('updates a task, scoped to the owner', async () => {
    // Same IDOR-shaped regression guard as the getById test above: assert
    // the update was filtered by owner, not just that the response body
    // reflects the mocked resolved value.
    Task.findOneAndUpdate.mockResolvedValue({ _id: 't1', title: 'A2', completed: true });
    const res = await request(app)
      .put('/api/tasks/t1')
      .set('Authorization', auth)
      .send({ title: 'A2', completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(Task.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 't1', owner: 'u1' },
      expect.anything(),
      expect.anything(),
    );
  });

  test('deletes a task, scoped to the owner', async () => {
    // Same IDOR-shaped regression guard as the getById/update tests above.
    Task.findOneAndDelete.mockResolvedValue({ _id: 't1' });
    const res = await request(app).delete('/api/tasks/t1').set('Authorization', auth);
    expect(res.status).toBe(204);
    expect(Task.findOneAndDelete).toHaveBeenCalledWith({ _id: 't1', owner: 'u1' });
  });

  test('404s deleting a missing task', async () => {
    Task.findOneAndDelete.mockResolvedValue(null);
    const res = await request(app).delete('/api/tasks/missing').set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  test('GET /:id returns 400 for a malformed id instead of hanging', async () => {
    const castErr = new Error('Cast to ObjectId failed');
    castErr.name = 'CastError';
    Task.findOne.mockRejectedValue(castErr);
    const res = await request(app).get('/api/tasks/not-a-valid-id').set('Authorization', auth);
    expect(res.status).toBe(400);
  });

  test('POST / returns 500 instead of hanging when the database call fails', async () => {
    Task.create.mockRejectedValue(new Error('connection lost'));
    const res = await request(app).post('/api/tasks').set('Authorization', auth).send({ title: 'X' });
    expect(res.status).toBe(500);
  });
});
