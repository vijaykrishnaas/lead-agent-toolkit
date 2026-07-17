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

  return app;
}

module.exports = { createApp };
