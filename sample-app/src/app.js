const express = require('express');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const tasksRoutes = require('./routes/tasks.routes');

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/tasks', tasksRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: 'Validation failed' });
    }
    // body-parser (express.json) errors carry a 4xx status and a type tag.
    if (typeof err.type === 'string' && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({
        error: err.status === 400 ? 'Invalid JSON body' : 'Request body rejected',
      });
    }
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
