const { parseRouterSource, parseAppEntrySource } = require('../../src/docDrift/parseExpressRoutes');

describe('parseRouterSource', () => {
  it('extracts one route per router.<verb>(path, ...) call', () => {
    const source = `
      const router = express.Router();
      router.use(auth);
      router.post('/', asyncHandler(create));
      router.get('/', asyncHandler(list));
      router.get('/:id', asyncHandler(getById));
      router.put('/:id', asyncHandler(update));
      router.delete('/:id', asyncHandler(remove));
      module.exports = router;
    `;

    const routes = parseRouterSource(source);

    expect(routes).toEqual([
      { method: 'POST', path: '/' },
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/:id' },
      { method: 'PUT', path: '/:id' },
      { method: 'DELETE', path: '/:id' },
    ]);
  });

  it('ignores router.use(middleware) calls (no HTTP verb)', () => {
    const source = `router.use(auth);\nrouter.use('/nested', subRouter);`;
    expect(parseRouterSource(source)).toEqual([]);
  });

  it('handles two routes of the same method in one file (does not collapse to a single occurrence)', () => {
    const source = `
      router.get('/', list);
      router.get('/:id', getById);
    `;
    const routes = parseRouterSource(source);
    expect(routes).toHaveLength(2);
    expect(routes).toEqual([
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/:id' },
    ]);
  });

  it('supports double-quoted path strings', () => {
    const source = `router.get("/:id", getById);`;
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/:id' }]);
  });
});

describe('parseAppEntrySource', () => {
  it('extracts direct app routes and resolves mounts to their required file', () => {
    const source = `
      const express = require('express');
      const authRoutes = require('./routes/auth.routes');
      const usersRoutes = require('./routes/users.routes');
      const tasksRoutes = require('./routes/tasks.routes');

      function createApp() {
        const app = express();
        app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
        app.use('/api/auth', authRoutes);
        app.use('/api/users', usersRoutes);
        app.use('/api/tasks', tasksRoutes);
        return app;
      }
    `;

    const { directRoutes, mounts } = parseAppEntrySource(source);

    expect(directRoutes).toEqual([{ method: 'GET', path: '/health' }]);
    expect(mounts).toEqual([
      { prefix: '/api/auth', requirePath: './routes/auth.routes' },
      { prefix: '/api/users', requirePath: './routes/users.routes' },
      { prefix: '/api/tasks', requirePath: './routes/tasks.routes' },
    ]);
  });

  it('skips a mount whose router variable has no matching require(...) in the source', () => {
    const source = `
      const express = require('express');
      const app = express();
      app.use('/inline', someInlineRouterBuiltElsewhere);
    `;

    const { mounts } = parseAppEntrySource(source);
    expect(mounts).toEqual([]);
  });

  it('handles multiple mounts each requiring a distinct file, not aggregating across the whole entry file', () => {
    const source = `
      const a = require('./a');
      const b = require('./b');
      app.use('/a', a);
      app.use('/b', b);
    `;
    const { mounts } = parseAppEntrySource(source);
    expect(mounts).toEqual([
      { prefix: '/a', requirePath: './a' },
      { prefix: '/b', requirePath: './b' },
    ]);
  });
});
