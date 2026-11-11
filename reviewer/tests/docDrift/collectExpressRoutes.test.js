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

  describe('a barrel that hands on another module wholesale (task 46)', () => {
    const collect = (files) => {
      const readFile = (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
        return files[filePath];
      };
      return collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile });
    };
    const tasksRoutes = { '/repo/src/routes/tasks.routes.js': "router.get('/:id', show);\nmodule.exports = router;" };
    const wholeMount = "const r = require('./routes');\napp.use('/api', r);";
    const namedMount = "const r = require('./routes');\napp.use('/api', r.tasks);";
    const all = { '/repo/src/routes/all.js': "module.exports = { tasks: require('./tasks.routes') };" };
    const listed = { routes: [{ method: 'GET', path: '/api/:id' }], unparsedRoutes: [] };

    it('(a) follows a whole-module mount of a whole-module re-export', () => {
      const files = { ...tasksRoutes, '/repo/src/app.js': wholeMount, '/repo/src/routes/index.js': "module.exports = require('./tasks.routes');" };
      expect(collect(files)).toEqual(listed);
    });

    it('(a) follows a whole-module re-export of a local bound by a relative require', () => {
      const files = { ...tasksRoutes, '/repo/src/app.js': wholeMount, '/repo/src/routes/index.js': "const tasks = require('./tasks.routes');\n\nmodule.exports = tasks;" };
      expect(collect(files)).toEqual(listed);
    });

    it('(a) follows a whole-module re-export of one member of a require', () => {
      const files = {
        '/repo/src/app.js': wholeMount,
        '/repo/src/routes/index.js': "module.exports = require('./tasks.routes').router;",
        '/repo/src/routes/tasks.routes.js': "router.get('/:id', show);\nmodule.exports = { router };",
      };
      expect(collect(files)).toEqual(listed);
    });

    it('(b) follows a named mount through a whole-module re-export of a barrel', () => {
      const files = { ...tasksRoutes, ...all, '/repo/src/app.js': namedMount, '/repo/src/routes/index.js': "module.exports = require('./all');" };
      expect(collect(files)).toEqual(listed);
    });

    it('(c) follows a named mount through a spread of a barrel', () => {
      const files = { ...tasksRoutes, ...all, '/repo/src/app.js': namedMount, '/repo/src/routes/index.js': "module.exports = { ...require('./all') };" };
      expect(collect(files)).toEqual(listed);
    });

    it('(c) follows a spread of a local, next to unrelated own entries', () => {
      const files = {
        ...tasksRoutes,
        ...all,
        '/repo/src/app.js': namedMount,
        '/repo/src/routes/index.js': "const more = require('./all');\nmodule.exports = { health: (req, res) => res.end('a,b}'), ...more };",
      };
      expect(collect(files)).toEqual(listed);
    });

    it('(c) lets the later spread that names the export win', () => {
      const files = {
        '/repo/src/app.js': namedMount,
        '/repo/src/routes/index.js': "module.exports = { ...require('./old'), ...require('./new'), ...require('./other') };",
        '/repo/src/routes/old.js': "module.exports = { tasks: require('./old.routes') };",
        '/repo/src/routes/new.js': "module.exports = { tasks: require('./new.routes') };",
        '/repo/src/routes/other.js': "module.exports = { users: require('./users.routes') };",
        '/repo/src/routes/old.routes.js': "router.get('/old', h);",
        '/repo/src/routes/new.routes.js': "router.get('/new', h);",
        '/repo/src/routes/users.routes.js': "router.get('/users', h);",
      };
      expect(collect(files).routes).toEqual([{ method: 'GET', path: '/api/new' }]);
    });

    it('(c) prefers an own entry over a spread, and reads the file itself when the own entry is local', () => {
      const own = {
        ...tasksRoutes,
        ...all,
        '/repo/src/app.js': namedMount,
        '/repo/src/routes/index.js': "module.exports = { ...require('./all'), tasks: require('./mine.routes') };",
        '/repo/src/routes/mine.routes.js': "router.get('/mine', h);",
      };
      expect(collect(own).routes).toEqual([{ method: 'GET', path: '/api/mine' }]);
      const local = { ...own, '/repo/src/routes/index.js': "router.get('/here', h);\nmodule.exports = { ...require('./all'), tasks: router };" };
      expect(collect(local).routes).toEqual([{ method: 'GET', path: '/api/here' }]);
    });

    for (const target of ['module.exports', 'exports']) {
      it(`(d) follows a named mount through Object.assign(${target}, { ... })`, () => {
        const files = {
          ...tasksRoutes,
          '/repo/src/app.js': namedMount,
          '/repo/src/routes/index.js': `Object.assign(${target}, { helper: make(1, 2) }, { tasks: require('./tasks.routes') });`,
        };
        expect(collect(files)).toEqual(listed);
      });
    }

    it('(d) follows a spread inside an Object.assign argument', () => {
      const files = { ...tasksRoutes, ...all, '/repo/src/app.js': namedMount, '/repo/src/routes/index.js': "Object.assign(module.exports, { ...require('./all') });" };
      expect(collect(files)).toEqual(listed);
    });

    it('follows a whole-module re-export chain of two files', () => {
      const files = {
        ...tasksRoutes,
        '/repo/src/app.js': wholeMount,
        '/repo/src/routes/index.js': "module.exports = require('./v1');",
        '/repo/src/routes/v1.js': "module.exports = require('./tasks.routes');",
      };
      expect(collect(files)).toEqual(listed);
    });

    it('terminates on a self-referencing whole-module re-export', () => {
      for (const appSource of [wholeMount, namedMount]) {
        const files = { '/repo/src/app.js': appSource, '/repo/src/routes/index.js': "module.exports = require('./index');" };
        expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [] });
      }
    });

    it('terminates on two files re-exporting each other', () => {
      const files = {
        '/repo/src/app.js': namedMount,
        '/repo/src/routes/index.js': "module.exports = { ...require('./all') };",
        '/repo/src/routes/all.js': "module.exports = require('./index');",
      };
      expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [] });
    });

    it('ignores a commented-out or quoted re-export line', () => {
      const sources = [
        "// module.exports = require('./tasks.routes');\nrouter.get('/own', h);\nmodule.exports = router;",
        "/* module.exports = require('./tasks.routes'); */\nconst note = \"module.exports = require('./tasks.routes');\";\nrouter.get('/own', h);",
        "// Object.assign(module.exports, { tasks: require('./tasks.routes') });\nconst s = '{ ...require(\"./all\") }';\nrouter.get('/own', h);",
      ];
      for (const source of sources) {
        for (const appSource of [wholeMount, namedMount]) {
          const files = { ...tasksRoutes, ...all, '/repo/src/app.js': appSource, '/repo/src/routes/index.js': source };
          expect(collect(files).routes).toEqual([{ method: 'GET', path: '/api/own' }]);
        }
      }
    });

    it('does not follow a re-export pointing at a bare package or a .json file', () => {
      const sources = [
        "module.exports = require('express-promise-router');",
        "module.exports = require('./config.json');",
        "module.exports = { ...require('lodash'), ...require('./config.json') };",
        "Object.assign(module.exports, { tasks: require('helmet') });",
      ];
      for (const source of sources) {
        for (const appSource of [wholeMount, namedMount]) {
          const files = { '/repo/src/app.js': appSource, '/repo/src/routes/index.js': source };
          expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [] });
        }
      }
    });

    it('reads the file itself when the re-export target is not a readable .js file', () => {
      const sources = ["module.exports = require('../config');", "module.exports = { ...require('../config') };"];
      for (const source of sources) {
        const files = { '/repo/src/app.js': namedMount, '/repo/src/config.json': '{}', '/repo/src/routes/index.js': source };
        expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [] });
      }
    });

    it('reads a file with its own routes or mounts itself, despite a whole-module re-export line', () => {
      const withRoutes = {
        '/repo/src/app.js': wholeMount,
        '/repo/src/routes/index.js': "const router = require('./makeRouter')();\nrouter.get('/own', h);\nmodule.exports = router;",
        '/repo/src/routes/makeRouter.js': "module.exports = () => express.Router();",
      };
      expect(collect(withRoutes).routes).toEqual([{ method: 'GET', path: '/api/own' }]);
      const withMounts = {
        ...tasksRoutes,
        ...withRoutes,
        '/repo/src/routes/index.js': "const router = require('./makeRouter')();\nrouter.use('/tasks', require('./tasks.routes'));\nmodule.exports = router;",
      };
      expect(collect(withMounts).routes).toEqual([{ method: 'GET', path: '/api/tasks/:id' }]);
    });

    it('does not treat a file with two module.exports statements as a wholesale barrel', () => {
      const files = {
        ...tasksRoutes,
        '/repo/src/app.js': wholeMount,
        '/repo/src/routes/index.js': "module.exports = require('./tasks.routes');\nif (legacy) module.exports = require('./legacy.routes');",
        '/repo/src/routes/legacy.routes.js': "router.get('/legacy', h);",
      };
      expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [] });
    });

    it('reports an unparsed route behind a wholesale barrel against the routes file', () => {
      const files = {
        '/repo/src/app.js': wholeMount,
        '/repo/src/routes/index.js': "module.exports = require('./tasks.routes');",
        '/repo/src/routes/tasks.routes.js': 'router.get(`/${id}`, show);',
      };
      expect(collect(files)).toEqual({
        routes: [],
        unparsedRoutes: [expect.objectContaining({ type: 'unparsed-route', file: '/repo/src/routes/tasks.routes.js' })],
      });
    });

    it('still lists the same router mounted twice through a wholesale barrel', () => {
      const files = {
        ...tasksRoutes,
        '/repo/src/app.js': "const r = require('./routes');\napp.use('/api/v1', r);\napp.use('/api/v2', r);",
        '/repo/src/routes/index.js': "module.exports = require('./tasks.routes');",
      };
      expect(collect(files).routes).toEqual([
        { method: 'GET', path: '/api/v1/:id' },
        { method: 'GET', path: '/api/v2/:id' },
      ]);
    });

    // Reviewer 2026-11-11 (review of dc38ea0): a whole-module hop was taken
    // whenever the file had no *listed* route or mount, so a file whose only
    // calls were unresolvable ones lost its unparsed-route warnings -- the
    // file was never read, only the module it got its router from.
    describe('a file whose own calls are all unresolvable is read itself, not hopped past', () => {
      const mount = { '/repo/src/app.js': "const r = require('./routes');\napp.use('/api', r);" };
      const warning = (method, line, what) => ({
        type: 'unparsed-route',
        method,
        line,
        reason: `${what} could not be statically resolved`,
        file: '/repo/src/routes/index.js',
      });

      it('keeps the warning for a template-literal path on a router from a local factory', () => {
        const files = {
          ...mount,
          '/repo/src/routes/index.js': "const router = require('./makeRouter')();\nrouter.get(`/${v}/x`, h);\nmodule.exports = router;",
          '/repo/src/routes/makeRouter.js': "module.exports = () => require('express').Router();",
        };
        expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [warning('GET', 2, 'route exists but path')] });
      });

      it('keeps the warning for an unresolved-name path on a re-exported router', () => {
        const files = {
          ...mount,
          ...tasksRoutes,
          '/repo/src/routes/index.js': "const router = require('./tasks.routes');\nrouter.post(P, h);\nmodule.exports = router;",
        };
        expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [warning('POST', 2, 'route exists but path')] });
      });

      it('keeps the warning for a mount with an unresolvable prefix', () => {
        const files = {
          ...mount,
          ...tasksRoutes,
          '/repo/src/routes/index.js': "const router = require('./tasks.routes');\nconst sub = require('./sub');\nrouter.use(base + '/x', sub);\nmodule.exports = router;",
          '/repo/src/routes/sub.js': "router.get('/s', h);",
        };
        expect(collect(files)).toEqual({ routes: [], unparsedRoutes: [warning('MOUNT', 3, 'mount exists but prefix')] });
      });

      it('still hops through a barrel whose only call-shaped text is commented out', () => {
        const files = {
          ...mount,
          ...tasksRoutes,
          '/repo/src/routes/index.js': "// router.get(`/${v}/x`, h);\nmodule.exports = require('./tasks.routes');",
        };
        expect(collect(files)).toEqual(listed);
      });
    });
  });

  describe('whole-module exports that are not one plain re-export line (task 49)', () => {
    const collect = (files) => {
      const readFile = (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
        return files[filePath];
      };
      return collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile });
    };
    const app = '/repo/src/app.js';
    const index = '/repo/src/r.js';
    const wholeMount = "const r = require('./r');\napp.use('/api', r);";
    const namedMount = "const r = require('./r');\napp.use('/api', r.tasks);";
    const make = {
      '/repo/src/make.js': ['module.exports = (db) => {', '  const router = express.Router();', "  router.get('/:id', show(db));", '  return router;', '};'].join('\n'),
    };
    const tasksRoutes = { '/repo/src/t.js': "router.get('/:id', show);\nmodule.exports = router;" };
    const barrel = { '/repo/src/a.js': "module.exports = { tasks: require('./t') };" };
    const listed = { routes: [{ method: 'GET', path: '/api/:id' }], unparsedRoutes: [] };
    const nothing = { routes: [], unparsedRoutes: [] };

    describe('(a) a factory call as the whole module', () => {
      it('follows an inline relative require called', () => {
        expect(collect({ ...make, [app]: wholeMount, [index]: "module.exports = require('./make')(db);" })).toEqual(listed);
      });

      it('follows a require-bound factory called', () => {
        expect(collect({ ...make, [app]: wholeMount, [index]: "const make = require('./make');\nmodule.exports = make(db);" })).toEqual(listed);
      });

      it('follows a call whose arguments span lines and hold parens, quotes and a comment', () => {
        const source = "const make = require('./make');\nmodule.exports = make({\n  db: connect('x)'), // )\n  log,\n});";
        expect(collect({ ...make, [app]: wholeMount, [index]: source })).toEqual(listed);
      });

      it('follows one member of a relative require called, through the barrel that names it', () => {
        const files = {
          ...make,
          [app]: wholeMount,
          [index]: "const factories = require('./factories');\nmodule.exports = factories.tasks(db);",
          '/repo/src/factories.js': "module.exports = { tasks: require('./make') };",
        };
        expect(collect(files)).toEqual(listed);
      });

      it('does not answer a named mount with a factory call: a member of its result is not an export of the file', () => {
        expect(collect({ ...make, [app]: namedMount, [index]: "module.exports = require('./make')(db);" })).toEqual(nothing);
      });

      it('reads a bare-package call itself', () => {
        const source = "const express = require('express');\nmodule.exports = express.Router();";
        expect(collect({ [app]: wholeMount, [index]: source })).toEqual(nothing);
      });

      it('reads a file with its own routes itself, despite exporting a factory call', () => {
        const source = "const wrap = require('./make');\nrouter.get('/own', h);\nmodule.exports = wrap(router);";
        expect(collect({ ...make, [app]: wholeMount, [index]: source })).toEqual({ routes: [{ method: 'GET', path: '/api/own' }], unparsedRoutes: [] });
      });

      it('does not unwrap a call of a call or a wrapped call', () => {
        expect(collect({ ...make, [app]: wholeMount, [index]: "module.exports = require('./make')(db)(x);" })).toEqual(nothing);
        expect(collect({ ...make, [app]: wholeMount, [index]: "const make = require('./make');\nmodule.exports = wrap(make(db));" })).toEqual(nothing);
      });

      it('terminates on a factory call of the file itself', () => {
        expect(collect({ [app]: wholeMount, [index]: "module.exports = require('./r')(db);" })).toEqual(nothing);
      });

      it('reads the file itself when the called require is not a readable .js file', () => {
        expect(collect({ [app]: wholeMount, [index]: "module.exports = require('./gone')(db);" })).toEqual(nothing);
      });
    });

    describe('(b) module.exports = exports = ...', () => {
      it('follows a whole-module mount', () => {
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "module.exports = exports = require('./t');" })).toEqual(listed);
      });

      it('follows a named mount', () => {
        expect(collect({ ...tasksRoutes, ...barrel, [app]: namedMount, [index]: "module.exports = exports = require('./a');" })).toEqual(listed);
      });

      it('still follows the mirrored exports = module.exports = ...', () => {
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "exports = module.exports = require('./t');" })).toEqual(listed);
      });
    });

    describe('(c) a right-hand side continued on a line starting with "."', () => {
      it('follows a member written on the next line for a whole-module mount', () => {
        expect(collect({ ...tasksRoutes, ...barrel, [app]: wholeMount, [index]: "module.exports = require('./a')\n  .tasks;" })).toEqual(listed);
      });

      it('follows it past a comment line and without a semicolon', () => {
        const source = "const a = require('./a');\nmodule.exports = a\n  // the tasks router\n  .tasks\n";
        expect(collect({ ...tasksRoutes, ...barrel, [app]: wholeMount, [index]: source })).toEqual(listed);
      });

      it('follows a factory call continued on the next line', () => {
        const source = "module.exports = require('./factories')\n  .tasks(db);";
        const files = { ...make, [app]: wholeMount, [index]: source, '/repo/src/factories.js': "module.exports = { tasks: require('./make') };" };
        expect(collect(files)).toEqual(listed);
      });

      it('follows a named export assignment continued on the next line', () => {
        expect(collect({ ...tasksRoutes, ...barrel, [app]: namedMount, [index]: "exports.tasks = require('./a')\n  .tasks;" })).toEqual(listed);
      });

      it('does not read a member of a call result as the bare call', () => {
        expect(collect({ ...make, [app]: wholeMount, [index]: "module.exports = require('./make')(db)\n  .router;" })).toEqual(nothing);
      });

      it('does not join a next line that starts another statement', () => {
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "module.exports = require('./t')\nconsole.log('loaded');" })).toEqual(listed);
      });
    });

    describe('(d) Object.assign with whitespace before the paren', () => {
      it('follows a named mount', () => {
        expect(collect({ ...tasksRoutes, [app]: namedMount, [index]: "Object.assign (module.exports, { tasks: require('./t') });" })).toEqual(listed);
      });

      it('follows a name behind a spread entry', () => {
        expect(collect({ ...tasksRoutes, ...barrel, [app]: namedMount, [index]: "Object.assign\n  (exports, { ...require('./a') });" })).toEqual(listed);
      });
    });

    describe('(e) a conditional whole-module export is not followed (documented limit)', () => {
      const branches = { '/repo/src/a.js': "router.get('/a', h);", '/repo/src/b.js': "router.get('/b', h);" };

      it('lists neither branch of a ternary', () => {
        expect(collect({ ...branches, [app]: wholeMount, [index]: "module.exports = c ? require('./a') : require('./b');" })).toEqual(nothing);
      });

      it('lists neither branch of a ternary continued on the next lines', () => {
        expect(collect({ ...branches, [app]: wholeMount, [index]: "module.exports = c\n  ? require('./a')\n  : require('./b');" })).toEqual(nothing);
      });

      it('lists neither branch of an if/else pair', () => {
        const source = "if (x) module.exports = require('./a'); else module.exports = require('./b');";
        expect(collect({ ...branches, [app]: wholeMount, [index]: source })).toEqual(nothing);
      });
    });

    describe('an operator on the line after the right-hand side makes it more than one value (2026-11-11 review of 34e648f)', () => {
      const barrelFile = { '/repo/src/a.js': "module.exports = { tasks: require('./t') };" };

      it.each([
        ['|| after a plain require', "module.exports = require('./t')\n  || fallback;"],
        ['?? after a plain require', "module.exports = require('./t')\n  ?? fallback;"],
        ['a ternary after a plain require', "module.exports = require('./t')\n  ? a\n  : b;"],
        ['|| after a factory call', "module.exports = require('./make')(db)\n  || fallback;"],
        ['|| after a member carried onto its own line', "module.exports = require('./a')\n  .tasks\n  || fallback;"],
        ['a call paren on the next line', "module.exports = require('./t')\n  (db);"],
        ['|| after a comment-only line', "module.exports = require('./t')\n  // or else\n  || fallback;"],
      ])('does not follow the first operand: %s', (_name, source) => {
        expect(collect({ ...make, ...tasksRoutes, ...barrelFile, [app]: wholeMount, [index]: source })).toEqual(nothing);
      });

      it('agrees with the same expression written on one line', () => {
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "module.exports = require('./t') || fallback;" })).toEqual(nothing);
      });

      it('does not follow the first operand of a named exports assignment either', () => {
        expect(collect({ ...tasksRoutes, [app]: namedMount, [index]: "exports.tasks = require('./t')\n  || fallback;" })).toEqual(nothing);
      });

      it('still follows a right-hand side whose next line is another statement, a blank line or a comment', () => {
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "module.exports = require('./t')\n\nconsole.log(1)" })).toEqual(listed);
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "module.exports = require('./t')\n// - note\n/* ? */\n" })).toEqual(listed);
        expect(collect({ ...tasksRoutes, [app]: wholeMount, [index]: "module.exports = require('./t');\n(function () {})();" })).toEqual(listed);
        expect(collect({ ...tasksRoutes, [app]: namedMount, [index]: "exports.tasks = require('./t')\nexports.other = 1" })).toEqual(listed);
      });
    });
  });

  describe('a router built by a factory exported from a relative require (task 44)', () => {
    const collect = (files) => {
      const readFile = (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
        return files[filePath];
      };
      return collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile });
    };
    const factory = [
      'module.exports = (db) => {',
      '  const router = express.Router();',
      "  router.get('/', list(db));",
      "  router.post('/', create(db));",
      '  return router;',
      '};',
    ].join('\n');
    const expected = {
      routes: [
        { method: 'GET', path: '/api/tasks' },
        { method: 'POST', path: '/api/tasks' },
      ],
      unparsedRoutes: [],
    };

    it('lists the routes of a factory called through a require binding', () => {
      const files = {
        '/repo/src/app.js': "const makeTasksRouter = require('./tasks.routes');\napp.use('/api/tasks', makeTasksRouter(db));",
        '/repo/src/tasks.routes.js': factory,
      };
      expect(collect(files)).toEqual(expected);
    });

    it('lists the routes of a factory called on an inline require', () => {
      const files = {
        '/repo/src/app.js': "app.use('/api/tasks', require('./tasks.routes')(db));",
        '/repo/src/tasks.routes.js': factory,
      };
      expect(collect(files)).toEqual(expected);
    });

    it('follows a factory called as a member of, or destructured from, a barrel', () => {
      for (const appSource of [
        "const routes = require('./routes');\napp.use('/api/tasks', auth(), routes.tasks(db));",
        "const { tasks: makeTasks } = require('./routes');\napp.use('/api/tasks', makeTasks(db));",
      ]) {
        const files = {
          '/repo/src/app.js': appSource,
          '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes') };",
          '/repo/src/routes/tasks.routes.js': factory,
        };
        expect(collect(files)).toEqual(expected);
      }
    });

    it('follows a relative middleware factory, which contributes no routes and no error', () => {
      const files = {
        '/repo/src/app.js': [
          "const requireRole = require('./middleware/roles');",
          "const { audit } = require('./middleware/audit');",
          "app.use(requireRole('admin'));",
          'app.use(audit({ level: 1 }));',
          "app.get('/health', ok);",
        ].join('\n'),
        '/repo/src/middleware/roles.js': 'module.exports = (role) => (req, res, next) => next();',
        '/repo/src/middleware/audit.js': 'exports.audit = (opts) => (req, res, next) => next();',
      };
      expect(collect(files)).toEqual({ routes: [{ method: 'GET', path: '/health' }], unparsedRoutes: [] });
    });
  });

  describe('a factory result bound to a local before it is mounted (task 47)', () => {
    const collect = (files) => {
      const readFile = (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
        return files[filePath];
      };
      return collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile });
    };
    const factory = [
      'module.exports = (db) => {',
      '  const router = express.Router();',
      "  router.get('/', list(db));",
      '  return router;',
      '};',
    ].join('\n');
    const barrel = {
      '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes') };",
      '/repo/src/routes/tasks.routes.js': factory,
    };
    const expected = { routes: [{ method: 'GET', path: '/api/tasks' }], unparsedRoutes: [] };

    it('(a) lists the routes of a require-bound factory called into a local', () => {
      const files = {
        '/repo/src/app.js': [
          "const makeTasksRouter = require('./tasks.routes');",
          'const tasksRouter = makeTasksRouter(db);',
          "app.use('/api/tasks', tasksRouter);",
        ].join('\n'),
        '/repo/src/tasks.routes.js': factory,
      };
      expect(collect(files)).toEqual(expected);
    });

    it('(b), (c), (d) follow a member, a destructured name and an inline require member through a barrel', () => {
      for (const appSource of [
        "const routes = require('./routes');\nconst tasksRouter = routes.tasks(db);\napp.use('/api/tasks', tasksRouter);",
        "const { tasks } = require('./routes');\nconst tasksRouter = tasks(db);\napp.use('/api/tasks', tasksRouter);",
        "const tasksRouter = require('./routes').tasks(db);\napp.use('/api/tasks', tasksRouter);",
      ]) {
        expect(collect({ '/repo/src/app.js': appSource, ...barrel })).toEqual(expected);
      }
    });

    it('lists the routes of a call-bound local mounted without a prefix', () => {
      const files = {
        '/repo/src/app.js': [
          "const makeTasksRouter = require('./tasks.routes');",
          'const tasksRouter = makeTasksRouter(db);',
          'app.use(tasksRouter);',
        ].join('\n'),
        '/repo/src/tasks.routes.js': factory,
      };
      expect(collect(files)).toEqual({ routes: [{ method: 'GET', path: '/' }], unparsedRoutes: [] });
    });

    it('keeps listing a local bound to a call of an inline whole-module require', () => {
      const files = {
        '/repo/src/app.js': "const tasksRouter = require('./tasks.routes')(db);\napp.use('/api/tasks', tasksRouter);",
        '/repo/src/tasks.routes.js': factory,
      };
      expect(collect(files)).toEqual(expected);
    });
  });

  describe('a local bound to one member of an inline relative require (2026-11-11 review of 6a5f76a)', () => {
    const collect = (files) => {
      const readFile = (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error(`ENOENT ${filePath}`), { code: 'ENOENT' });
        return files[filePath];
      };
      return collectExpressRoutes({ appEntryPath: '/repo/src/app.js' }, { readFile });
    };
    const router = "const router = express.Router();\nrouter.get('/', list);\nmodule.exports = router;";
    const factory = "module.exports = (db) => {\n  const router = express.Router();\n  router.get('/', list(db));\n  return router;\n};";
    const expected = { routes: [{ method: 'GET', path: '/api/tasks' }], unparsedRoutes: [] };

    it('follows the member through a barrel instead of reading the barrel itself', () => {
      const files = {
        '/repo/src/app.js': "const tasksRouter = require('./routes').tasks;\napp.use('/api/tasks', tasksRouter);",
        '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes') };",
        '/repo/src/routes/tasks.routes.js': router,
      };
      expect(collect(files)).toEqual(expected);
    });

    it('follows the member when the bound name is called inline or into a second local', () => {
      for (const appSource of [
        "const makeTasks = require('./routes').tasks;\napp.use('/api/tasks', makeTasks(db));",
        "const makeTasks = require('./routes').tasks;\nconst tasksRouter = makeTasks(db);\napp.use('/api/tasks', tasksRouter);",
      ]) {
        const files = {
          '/repo/src/app.js': appSource,
          '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes') };",
          '/repo/src/routes/tasks.routes.js': factory,
        };
        expect(collect(files)).toEqual(expected);
      }
    });

    it('follows a barrel that exports such a local by name', () => {
      const files = {
        '/repo/src/app.js': "const routes = require('./routes');\napp.use('/api/tasks', routes.tasks);",
        '/repo/src/routes/index.js': "const tasks = require('./all').tasks;\nmodule.exports = { tasks };",
        '/repo/src/routes/all.js': "module.exports = { tasks: require('./tasks.routes') };",
        '/repo/src/routes/tasks.routes.js': router,
      };
      expect(collect(files)).toEqual(expected);
    });

    it('still reads the required file itself when it defines the member in place', () => {
      const files = {
        '/repo/src/app.js': "const tasksRouter = require('./tasks.routes').router;\napp.use('/api/tasks', tasksRouter);",
        '/repo/src/tasks.routes.js': "const router = express.Router();\nrouter.get('/', list);\nmodule.exports = { router };",
      };
      expect(collect(files)).toEqual(expected);
    });

    it('lets a later whole-module binding of the same name win, as before', () => {
      const files = {
        '/repo/src/app.js': [
          "function a() { const r = require('./routes').tasks; return r; }",
          "const r = require('./other.routes');",
          "app.use('/api/other', r);",
        ].join('\n'),
        '/repo/src/routes/index.js': "module.exports = { tasks: require('./tasks.routes') };",
        '/repo/src/routes/tasks.routes.js': router,
        '/repo/src/other.routes.js': router,
      };
      expect(collect(files)).toEqual({ routes: [{ method: 'GET', path: '/api/other' }], unparsedRoutes: [] });
    });
  });
});
