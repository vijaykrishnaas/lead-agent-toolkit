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

    const routes = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([
      { method: 'GET', path: '/health' },
      { method: 'POST', path: '/api/auth/register' },
      { method: 'POST', path: '/api/auth/login' },
      { method: 'POST', path: '/api/tasks' },
      { method: 'GET', path: '/api/tasks' },
      { method: 'GET', path: '/api/tasks/:id' },
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
});
