const { parseRouterSource, parseAppEntrySource, findUnparsedRoutes } = require('../../src/docDrift/parseExpressRoutes');

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

  it('recognizes router.options(...) and router.head(...), not only the five original verbs', () => {
    // Regression: HTTP_METHODS here used to omit 'options'/'head' while
    // parseOpenApi.js's own list included them, so a real, implemented
    // OPTIONS/HEAD route silently vanished from the code-side route list
    // and compareRoutes() reported it as missing from code even though it
    // was fully implemented.
    const source = `
      router.options('/widgets', corsHandler);
      router.head('/widgets', headHandler);
      router.get('/widgets', listHandler);
    `;
    expect(parseRouterSource(source)).toEqual([
      { method: 'OPTIONS', path: '/widgets' },
      { method: 'HEAD', path: '/widgets' },
      { method: 'GET', path: '/widgets' },
    ]);
  });
  it('extracts routes defined via router.route(path).<verb>() chaining', () => {
    // Regression: METHOD_CALL_PATTERN requires the verb call to be
    // immediately preceded by "router." or "app.", so a chained call like
    // router.route('/widgets').get(fn).post(fn) never matched at all — the
    // token before ".get(" is ")" from ".route(...)", not "router" — and
    // the whole route silently vanished from the extracted route list.
    const source = `
      router.route('/widgets').get(listWidgets).post(createWidget);
      router.route('/widgets/:id')
        .get(getWidget)
        .put(updateWidget)
        .delete(deleteWidget);
    `;

    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/widgets' },
      { method: 'POST', path: '/widgets' },
      { method: 'GET', path: '/widgets/:id' },
      { method: 'PUT', path: '/widgets/:id' },
      { method: 'DELETE', path: '/widgets/:id' },
    ]);
  });

  it('does not let one .route() chain\'s verbs bleed into the next .route() chain in the same file', () => {
    const source = `
      router.route('/a').get(getA);
      router.route('/b').post(createB);
    `;

    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
    ]);
  });

  it('does not treat a commented-out router.<verb>() call as a real route', () => {
    // Regression: METHOD_CALL_PATTERN matched raw source text, so a
    // commented-out route (e.g. dead code left behind after removing an
    // endpoint) was reported as a live, implemented route — silencing a
    // genuine doc-drift finding if the route is still documented in
    // openapi.yaml but was actually removed from code.
    const source = `
      // router.delete('/:id', asyncHandler(remove));
      router.get('/', asyncHandler(list));
    `;
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/' }]);
  });

  it('does not treat a commented-out .route(path).<verb>() chain as real routes', () => {
    const source = `
      // router.route('/widgets').get(listWidgets).delete(removeWidget);
      router.route('/widgets').post(createWidget);
    `;
    expect(parseRouterSource(source)).toEqual([{ method: 'POST', path: '/widgets' }]);
  });

  it('does not treat a commented-out chained verb between two real chained verbs as a real route', () => {
    const source = `
      router.route('/a')
        .get(getA)
        // .delete(deleteA)
        .put(putA);
    `;
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'PUT', path: '/a' },
    ]);
  });

  it('still resolves the chain when a comment sits before the first chained verb', () => {
    // Closes the open question raised in run 7's PROGRESS.md entry: a
    // comment directly after .route(path), before any real chained verb,
    // was flagged as worth a follow-up check rather than assumed safe by
    // parity with the "comment between two real verbs" case above.
    // Reproduced and confirmed already correct (commentMasked reads a
    // comment-only line as whitespace to the leading \s* in
    // collectChainedVerbs' verb-match, same as the between-verbs case) --
    // this test only adds the missing regression coverage.
    const source = `
      router.route('/a')
        // leading comment before the first chained verb
        .get(getA)
        .put(putA);
    `;
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'PUT', path: '/a' },
    ]);
  });

  it('does not sweep an unrelated router.<verb>() statement sitting between two .route() chains into the first chain', () => {
    // Regression: the chain boundary used to be "up to the next .route()
    // call's index," so an unrelated router.get('/b', ...) statement sitting
    // between two .route() chains got scanned as if it were part of the
    // first chain, duplicating GET /a (once from METHOD_CALL_PATTERN's own
    // direct match on router.get, once again from the mis-bounded chain
    // scan) instead of leaving the first chain as just its own single verb.
    const source = `
      router.route('/a')
        .get(getA);

      router.get('/b', getB);

      router.route('/c')
        .get(getC);
    `;

    const routes = parseRouterSource(source);
    expect(routes.filter((r) => r.method === 'GET' && r.path === '/a')).toHaveLength(1);
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/b' },
        { method: 'GET', path: '/a' },
        { method: 'GET', path: '/c' },
      ]),
    );
    expect(routes).toHaveLength(3);
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

  it('does not treat a commented-out app.use(...) mount as a real one', () => {
    // Regression: MOUNT_PATTERN/REQUIRE_PATTERN matched raw source text, so
    // a commented-out mount (e.g. a disabled/removed route module) was
    // reported as a live mount, and a real require() line that happens to
    // sit only inside a comment was likewise resolved as if it existed.
    const source = `
      const secretRoutes = require('./routes/secret.routes');
      // app.use('/api/secret', secretRoutes);
      app.use('/api/tasks', secretRoutes);
    `;
    const { mounts } = parseAppEntrySource(source);
    expect(mounts).toEqual([{ prefix: '/api/tasks', requirePath: './routes/secret.routes' }]);
  });

  it('does not resolve a mount whose require(...) only appears inside a comment', () => {
    const source = `
      // const secretRoutes = require('./routes/secret.routes');
      app.use('/api/secret', secretRoutes);
    `;
    const { mounts } = parseAppEntrySource(source);
    expect(mounts).toEqual([]);
  });

  it('still resolves a mount when one or more middleware args sit between the prefix and the router', () => {
    const source = `
      const authMiddleware = require('./middleware/auth');
      const tasksRoutes = require('./routes/tasks.routes');
      const usersRoutes = require('./routes/users.routes');
      app.use('/api/tasks', authMiddleware, tasksRoutes);
      app.use('/api/users', authMiddleware, someValidator, usersRoutes);
    `;
    const { mounts } = parseAppEntrySource(source);
    expect(mounts).toEqual([
      { prefix: '/api/tasks', requirePath: './routes/tasks.routes' },
      { prefix: '/api/users', requirePath: './routes/users.routes' },
    ]);
  });
});

describe('findUnparsedRoutes', () => {
  it('reports a template-literal router.<verb>() path as an unparsed-route finding, and does not extract it as a real route', () => {
    // AUDIT.md F8: METHOD_CALL_PATTERN only matches quote-delimited paths,
    // so a template-literal path (interpolated, can't be resolved
    // statically) previously just vanished from the route list entirely --
    // neither documented-and-missing nor implemented, silently invisible.
    const source = "router.get('/', list);\nrouter.get(`/widgets/${id}`, getWidget);";

    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/' }]);
    expect(findUnparsedRoutes(source)).toEqual([
      {
        type: 'unparsed-route',
        method: 'GET',
        line: 2,
        reason: 'route exists but path could not be statically resolved',
      },
    ]);
  });

  it('reports a template-literal .route(path) call as an unparsed-route finding', () => {
    const source = 'router.route(`/widgets/${id}`).get(getWidget).post(createWidget);';

    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([
      {
        type: 'unparsed-route',
        method: null,
        line: 1,
        reason: 'route exists but path could not be statically resolved',
      },
    ]);
  });

  it('reports a template-literal app|router.use() mount prefix as its own unparsed-route finding', () => {
    const source = "const tasksRoutes = require('./routes/tasks.routes');\napp.use(`/api/${version}/tasks`, tasksRoutes);";

    const { mounts } = parseAppEntrySource(source);
    expect(mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([
      {
        type: 'unparsed-route',
        method: 'MOUNT',
        line: 2,
        reason: 'mount exists but prefix could not be statically resolved',
      },
    ]);
  });

  it('does not treat a commented-out template-literal route call as a real unparsed finding', () => {
    const source = '// router.get(`/widgets/${id}`, getWidget);\nrouter.get(\'/\', list);';
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('returns no findings when every route/mount in the source uses a plain quoted path', () => {
    const source = "router.get('/', list);\napp.use('/api/tasks', tasksRoutes);";
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('reports the correct line number when a multi-line /* */ block comment precedes the unparsed route', () => {
    // Regression: maskComments used to replace every character of a block
    // comment -- including its own embedded newlines -- with a single
    // space, so lineNumberAt (which counts '\n' in the masked text) lost
    // one line per newline swallowed inside any preceding block comment
    // and reported an earlier, wrong line for every finding after it.
    const source = [
      "const express = require('express');",
      '/*',
      ' * multi-line block comment',
      ' * spanning several lines',
      ' */',
      'const router = express.Router();',
      'router.get(`/widgets/${id}`, getWidget);',
    ].join('\n');

    expect(findUnparsedRoutes(source)).toEqual([
      {
        type: 'unparsed-route',
        method: 'GET',
        line: 7,
        reason: 'route exists but path could not be statically resolved',
      },
    ]);
  });
});
