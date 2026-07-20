const path = require('path');
const { collectExpressRoutes, joinPath } = require('../../src/docDrift/collectExpressRoutes');

describe('joinPath', () => {
  it('returns the prefix as-is when the router path is just "/"', () => {
    expect(joinPath('/api/tasks', '/')).toBe('/api/tasks');
  });

  it('joins a prefix and a sub-path without doubling the slash', () => {
    expect(joinPath('/api/tasks', '/:id')).toBe('/api/tasks/:id');
  });

  it('inserts a slash when the router path is missing its leading slash', () => {
    expect(joinPath('/api/tasks', ':id')).toBe('/api/tasks/:id');
  });
});

describe('collectExpressRoutes', () => {
  const appEntryPath = '/repo/src/app.js';

  const appSource = `
    const authRoutes = require('./routes/auth.routes');
    const tasksRoutes = require('./routes/tasks.routes');
    app.get('/health', handler);
    app.use('/api/auth', authRoutes);
    app.use('/api/tasks', tasksRoutes);
  `;
  const authRouterSource = `
    router.post('/register', register);
    router.post('/login', login);
  `;
  const tasksRouterSource = `
    router.post('/', create);
    router.get('/', list);
    router.get('/:id', getById);
  `;

  it('combines direct app routes and every mounted router into full paths', () => {
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) return appSource;
      if (filePath === path.resolve('/repo/src', './routes/auth.routes.js')) return authRouterSource;
      if (filePath === path.resolve('/repo/src', './routes/tasks.routes.js')) return tasksRouterSource;
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([
      { method: 'GET', path: '/health' },
      { method: 'POST', path: '/api/auth/register' },
      { method: 'POST', path: '/api/auth/login' },
      { method: 'POST', path: '/api/tasks' },
      { method: 'GET', path: '/api/tasks' },
      { method: 'GET', path: '/api/tasks/:id' },
    ]);
  });

  it('follows a router file that itself mounts a nested sub-router, instead of dropping the sub-router\'s routes', () => {
    // Regression: only the app entry file was ever scanned for mounts, so a
    // router file mounting its own nested sub-router (e.g. tasks.routes.js
    // mounting comments.routes.js under '/:id/comments') had the entire
    // sub-router's routes silently missing from the collected set.
    const nestedTasksRouterSource = `
      const commentsRoutes = require('./comments.routes');
      router.get('/', list);
      router.use('/:id/comments', commentsRoutes);
    `;
    const commentsRouterSource = `
      router.get('/', listComments);
      router.post('/', createComment);
    `;
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) return `const tasksRoutes = require('./routes/tasks.routes');\napp.use('/api/tasks', tasksRoutes);`;
      if (filePath === path.resolve('/repo/src', './routes/tasks.routes.js')) return nestedTasksRouterSource;
      if (filePath === path.resolve('/repo/src/routes', './comments.routes.js')) return commentsRouterSource;
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([
      { method: 'GET', path: '/api/tasks' },
      { method: 'GET', path: '/api/tasks/:id/comments' },
      { method: 'POST', path: '/api/tasks/:id/comments' },
    ]);
  });

  it('collects routes from a router file mounted at two different prefixes, instead of dropping the second mount', () => {
    // Regression: the cycle guard used a single `visited` Set shared across
    // the entire recursive walk, so mounting the same router file a second
    // time under a different prefix (a legitimate pattern, e.g. API
    // versioning) was treated as if it were a require cycle and silently
    // produced zero routes for the second mount.
    const thingsRouterSource = `
      router.get('/', list);
      router.get('/:id', getById);
    `;
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) {
        return `
          const thingsRoutes = require('./routes/things.routes');
          app.use('/api/v1/things', thingsRoutes);
          app.use('/api/v2/things', thingsRoutes);
        `;
      }
      if (filePath === path.resolve('/repo/src', './routes/things.routes.js')) return thingsRouterSource;
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([
      { method: 'GET', path: '/api/v1/things' },
      { method: 'GET', path: '/api/v1/things/:id' },
      { method: 'GET', path: '/api/v2/things' },
      { method: 'GET', path: '/api/v2/things/:id' },
    ]);
  });

  it('still guards against a genuine require cycle along one ancestor chain', () => {
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) {
        return `const a = require('./routes/a.routes');\napp.use('/api/a', a);`;
      }
      if (filePath === path.resolve('/repo/src', './routes/a.routes.js')) {
        return `router.get('/', listA);\nconst b = require('./b.routes');\nrouter.use('/b', b);`;
      }
      if (filePath === path.resolve('/repo/src/routes', './b.routes.js')) {
        return `router.get('/', listB);\nconst a = require('./a.routes');\nrouter.use('/a-again', a);`;
      }
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([
      { method: 'GET', path: '/api/a' },
      { method: 'GET', path: '/api/a/b' },
    ]);
  });

  it('resolves a requirePath that already ends in .js without appending a second .js', () => {
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) {
        return `const r = require('./routes/tasks.routes.js');\napp.use('/api/tasks', r);`;
      }
      return tasksRouterSource;
    });

    collectExpressRoutes({ appEntryPath }, { readFile });

    expect(readFile).toHaveBeenCalledWith(path.resolve('/repo/src', './routes/tasks.routes.js'));
  });

  it('reports an unparsed-route finding, tagged with its own file, for a template-literal route path', () => {
    // AUDIT.md F8: a template-literal path (e.g. router.get(`/widgets/${id}`,
    // ...)) can't be statically resolved, so it must not just silently vanish
    // from the collected route set -- it needs an explicit warning finding
    // instead, tagged with the file it came from (not the app entry file),
    // so a report reader knows exactly where to look.
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) return `const tasksRoutes = require('./routes/tasks.routes');\napp.use('/api/tasks', tasksRoutes);`;
      if (filePath === path.resolve('/repo/src', './routes/tasks.routes.js')) {
        return "router.get('/', list);\nrouter.get(`/widgets/${id}`, getWidget);";
      }
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes, unparsedRoutes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([{ method: 'GET', path: '/api/tasks' }]);
    expect(unparsedRoutes).toEqual([
      {
        type: 'unparsed-route',
        method: 'GET',
        line: 2,
        reason: 'route exists but path could not be statically resolved',
        file: path.resolve('/repo/src', './routes/tasks.routes.js'),
      },
    ]);
  });

  it('reports an unparsed-route finding for a template-literal mount prefix, and does not recurse into it', () => {
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) {
        return "const tasksRoutes = require('./routes/tasks.routes');\napp.use(`/api/${version}/tasks`, tasksRoutes);";
      }
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes, unparsedRoutes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([]);
    expect(unparsedRoutes).toEqual([
      {
        type: 'unparsed-route',
        method: 'MOUNT',
        line: 2,
        reason: 'mount exists but prefix could not be statically resolved',
        file: appEntryPath,
      },
    ]);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
