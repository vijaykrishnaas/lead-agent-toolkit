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

  it('reports an unparsed-route finding for a non-literal prefix variable, and does not recurse into it (task 38)', () => {
    const readFile = jest.fn((filePath) => {
      if (filePath === appEntryPath) {
        return [
          "const API = process.env.API_PREFIX || '/api';",
          "const tasksRoutes = require('./routes/tasks.routes');",
          'app.use(API, tasksRoutes);',
        ].join('\n');
      }
      throw new Error(`unexpected read: ${filePath}`);
    });

    const { routes, unparsedRoutes } = collectExpressRoutes({ appEntryPath }, { readFile });

    expect(routes).toEqual([]);
    expect(unparsedRoutes).toEqual([
      {
        type: 'unparsed-route',
        method: 'MOUNT',
        line: 3,
        reason: 'mount exists but prefix could not be statically resolved',
        file: appEntryPath,
      },
    ]);
    expect(readFile).toHaveBeenCalledTimes(1);
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

  it('does not try to read a mounted npm package as a router file', () => {
    const readFile = jest.fn(() => `
      const swagger = require('swagger-ui-express');
      app.get('/health', handler);
      app.use('/docs', swagger);
    `);
    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });
    expect(routes).toEqual([{ method: 'GET', path: '/health' }]);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
  it('falls back to <dir>/index.js when a mounted require resolves to a directory', () => {
    const files = {
      [appEntryPath]: "const r = require('./routes');\napp.use('/x', r);",
      [require('path').resolve(require('path').dirname(appEntryPath), 'routes/index.js')]: "router.get('/y', h);",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });
    expect(routes).toEqual([{ method: 'GET', path: '/x/y' }]);
  });
  it.each(['.cjs', '.mjs'])('resolves a mounted router file with an explicit %s extension exactly', (ext) => {
    const dir = require('path').dirname(appEntryPath);
    const files = {
      [appEntryPath]: `app.use('/x', require('./routes/r${ext}'));`,
      [require('path').resolve(dir, `routes/r${ext}`)]: "router.get('/y', h);",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    const { routes } = collectExpressRoutes({ appEntryPath }, { readFile });
    expect(routes).toEqual([{ method: 'GET', path: '/x/y' }]);
  });

  it('collects the routes of a prefixless mount, and zero routes from a required non-router middleware module', () => {
    const files = {
      '/repo/src/app.js': [
        "const errorHandler = require('./middleware/errorHandler');",
        "const api = require('./routes');",
        "app.use('/api', api);",
        "app.use(require('./routes/health.routes'));",
        'app.use(errorHandler);',
      ].join('\n'),
      '/repo/src/routes/index.js': "const things = require('./things.routes');\nrouter.use(things);",
      '/repo/src/routes/things.routes.js': "router.get('/things', list);",
      '/repo/src/routes/health.routes.js': "router.get('/health', ok);",
      '/repo/src/middleware/errorHandler.js': 'module.exports = (err, req, res, next) => res.status(500).end();',
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) {
        const err = new Error(`ENOENT: ${filePath}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[filePath];
    };
    expect(collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile })).toEqual({
      routes: [
        { method: 'GET', path: '/api/things' },
        { method: 'GET', path: '/health' },
      ],
      unparsedRoutes: [],
    });
  });

  it('joins a const-string prefix variable onto the mounted router\'s routes', () => {
    const files = {
      '/repo/src/app.js': "const API = '/api/tasks';\nconst tasks = require('./tasks.routes');\napp.use(API, tasks);",
      '/repo/src/tasks.routes.js': "router.get('/:id', show);",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    expect(collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile }).routes).toEqual([
      { method: 'GET', path: '/api/tasks/:id' },
    ]);
  });

  it('follows a router reached through a member of, or destructured from, a relative require (task 41)', () => {
    const files = {
      '/repo/src/app.js': [
        "const tasksModule = require('./tasks.routes');",
        "const { router: usersRouter } = require('./users.routes');",
        "app.use('/api/tasks', tasksModule.router);",
        "app.use('/api/users', requireAuth, usersRouter);",
      ].join('\n'),
      '/repo/src/tasks.routes.js': "router.get('/:id', show);\nmodule.exports = { router };",
      '/repo/src/users.routes.js': "router.post('/', create);\nmodule.exports = { router };",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    expect(collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile })).toEqual({
      routes: [
        { method: 'GET', path: '/api/tasks/:id' },
        { method: 'POST', path: '/api/users' },
      ],
      unparsedRoutes: [],
    });
  });

  describe('a router reached through a barrel file (task 43)', () => {
    const collect = (files) => {
      const readFile = (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
        return files[filePath];
      };
      return collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile });
    };
    const routerFiles = {
      '/repo/src/routes/tasks.routes.js': "router.get('/:id', show);\nmodule.exports = router;",
      '/repo/src/routes/users.routes.js': "router.post('/', create);\nmodule.exports = router;",
    };
    const barrels = {
      'inline require in module.exports': "module.exports = { tasks: require('./tasks.routes'), users: require('./users.routes') };",
      'exports.name assignments': "exports.tasks = require('./tasks.routes');\nmodule.exports.users = require('./users.routes');",
      'shorthand locals': "const tasks = require('./tasks.routes');\nconst u = require('./users.routes');\nmodule.exports = { tasks, users: u };",
    };
    const mountStyles = {
      member: "const routes = require('./routes');\napp.use('/api/tasks', routes.tasks);\napp.use('/api/users', auth(), routes.users);",
      destructured: "const { tasks, users } = require('./routes');\napp.use('/api/tasks', tasks);\napp.use('/api/users', users);",
      'aliased destructure': "const { tasks: t, users: u } = require('./routes');\napp.use('/api/tasks', t);\napp.use('/api/users', u);",
      'inline require member': "app.use('/api/tasks', require('./routes').tasks);\napp.use('/api/users', require('./routes').users);",
    };

    for (const [barrelName, barrelSource] of Object.entries(barrels)) {
      for (const [mountName, appSource] of Object.entries(mountStyles)) {
        it(`follows two routers through a barrel (${barrelName}) mounted by ${mountName}`, () => {
          const files = { ...routerFiles, '/repo/src/app.js': appSource, '/repo/src/routes/index.js': barrelSource };
          expect(collect(files)).toEqual({
            routes: [
              { method: 'GET', path: '/api/tasks/:id' },
              { method: 'POST', path: '/api/users' },
            ],
            unparsedRoutes: [],
          });
        });
      }
    }

    it('follows a barrel that re-exports from another barrel, and a named export of the routes file', () => {
      const files = {
        '/repo/src/app.js': "const { tasks } = require('./routes');\napp.use('/api/tasks', tasks);",
        '/repo/src/routes/index.js': "const { tasks } = require('./v1');\nmodule.exports = { tasks };",
        '/repo/src/routes/v1/index.js': "exports.tasks = require('./tasks.routes').router;",
        '/repo/src/routes/v1/tasks.routes.js': "router.get('/:id', show);\nmodule.exports = { router };",
      };
      expect(collect(files).routes).toEqual([{ method: 'GET', path: '/api/tasks/:id' }]);
    });

    it('reports an unparsed route found behind the barrel against the routes file', () => {
      const files = {
        '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api/tasks', routes.tasks);",
        '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes') };",
        '/repo/src/routes/tasks.routes.js': 'router.get(`/${id}`, show);',
      };
      expect(collect(files)).toEqual({
        routes: [],
        unparsedRoutes: [expect.objectContaining({ type: 'unparsed-route', file: '/repo/src/routes/tasks.routes.js' })],
      });
    });

    it('ignores a commented-out export line in the barrel', () => {
      const files = {
        ...routerFiles,
        '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api/tasks', routes.tasks);",
        '/repo/src/routes/index.js': "// exports.tasks = require('./users.routes');\nexports.tasks = require('./tasks.routes');",
      };
      expect(collect(files).routes).toEqual([{ method: 'GET', path: '/api/tasks/:id' }]);
    });

    it('still reads the required file itself when the name is not re-exported from another file', () => {
      const files = {
        '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api', routes.router);\napp.use('/x', routes.missing);",
        '/repo/src/routes/index.js': "router.get('/ping', ping);\nmodule.exports = { router, pkg: require('helmet'), cfg: require('./cfg.json') };",
      };
      expect(collect(files).routes).toEqual([
        { method: 'GET', path: '/api/ping' },
        { method: 'GET', path: '/x/ping' },
      ]);
      files['/repo/src/app.js'] = "const routes = require('./routes');\napp.use('/p', routes.pkg);\napp.use('/c', routes.cfg);";
      expect(collect(files).routes).toEqual([
        { method: 'GET', path: '/p/ping' },
        { method: 'GET', path: '/c/ping' },
      ]);
    });

    it('terminates on a barrel export that points back at itself', () => {
      const files = {
        '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api', routes.tasks);",
        '/repo/src/routes/index.js': "exports.tasks = require('./other').tasks;",
        '/repo/src/routes/other.js': "exports.tasks = require('./index').tasks;",
      };
      expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [] });
    });

    it('lets a routes file behind a barrel mount a sibling through the same barrel', () => {
      const files = {
        '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api/tasks', routes.tasks);",
        '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes'), users: require('./users.routes') };",
        '/repo/src/routes/tasks.routes.js': "const routes = require('./index');\nrouter.get('/:id', show);\nrouter.use('/:id/users', routes.users);",
        '/repo/src/routes/users.routes.js': "router.post('/', create);",
      };
      expect(collect(files).routes).toEqual([
        { method: 'GET', path: '/api/tasks/:id' },
        { method: 'POST', path: '/api/tasks/:id/users' },
      ]);
    });
  });

  it('does not try to read a relative .json/.node require used as a use() argument as a router file', () => {
    const files = {
      '/repo/src/app.js': [
        "const cfg = require('./config.json');",
        "const { limiter } = require('./settings.json');",
        "const native = require('./build/addon.node');",
        "app.use(cfg.mw);",
        "app.use('/api', limiter);",
        "app.use(native);",
        "app.use('/api/tasks', require('./tasks.routes'));",
      ].join('\n'),
      '/repo/src/config.json': '{}',
      '/repo/src/settings.json': '{}',
      '/repo/src/tasks.routes.js': "router.get('/:id', show);",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    expect(collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile })).toEqual({
      routes: [{ method: 'GET', path: '/api/tasks/:id' }],
      unparsedRoutes: [],
    });
  });

  it('reads the barrel itself when its re-export points at a file that is not readable as .js', () => {
    // Regression (task 43 review): the hop resolved `../config` to config.js
    // and `../build/Release/addon` to addon.js and aborted the whole run with
    // ENOENT; before task 43 only the barrel was read and the run succeeded.
    const files = {
      '/repo/src/app.js': [
        "const { limiter } = require('./middleware');",
        "const mw = require('./mw');",
        "app.use(limiter);",
        "app.use(mw.auth);",
        "app.use('/api/tasks', require('./tasks.routes'));",
      ].join('\n'),
      '/repo/src/middleware/index.js': "const config = require('../config');\nmodule.exports = { limiter: config.limiter };",
      '/repo/src/mw.js': "const native = require('../build/Release/addon');\nexports.auth = native.auth;\nrouter.get('/own', h);",
      '/repo/src/config.json': '{}',
      '/repo/src/tasks.routes.js': "router.get('/:id', show);",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    expect(collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile })).toEqual({
      routes: [{ method: 'GET', path: '/own' }, { method: 'GET', path: '/api/tasks/:id' }],
      unparsedRoutes: [],
    });
  });

  it('still surfaces a read error other than ENOENT from a barrel re-export target', () => {
    const files = {
      '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api', routes.tasks);",
      '/repo/src/routes.js': "module.exports = { tasks: require('./tasks.routes') };",
    };
    const readFile = (filePath) => {
      if (filePath === '/repo/src/tasks.routes.js') throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    expect(() => collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile })).toThrow('EACCES');
  });

  it('follows a barrel written as `module.exports = exports = { ... }`', () => {
    const files = {
      '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api/tasks', routes.tasks);",
      '/repo/src/routes/index.js': "module.exports = exports = { tasks: require('./tasks.routes') };",
      '/repo/src/routes/tasks.routes.js': "router.get('/:id', show);",
    };
    const readFile = (filePath) => {
      if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
      return files[filePath];
    };
    expect(collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile })).toEqual({
      routes: [{ method: 'GET', path: '/api/tasks/:id' }],
      unparsedRoutes: [],
    });
  });
});
