const { parseRouterSource, parseAppEntrySource, findUnparsedRoutes, findExportedRequire, findExportHops, declaresExport } = require('../../src/docDrift/parseExpressRoutes');

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
  it('recognizes router.trace(...), which Express supports and OpenAPI 3.x documents', () => {
    expect(parseRouterSource("router.trace('/widgets', traceHandler);")).toEqual([
      { method: 'TRACE', path: '/widgets' },
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

  it('keeps collecting verbs after a chained .all() in a .route() chain', () => {
    // Regression: .all(mw) is the idiomatic per-path middleware hook in a
    // route chain. It is not an HTTP verb, so the chain walk stopped at it
    // and every real verb chained after it silently vanished.
    const source = `
      router.route('/widgets').all(requireAuth).get(listWidgets).post(createWidget);
      router.route('/gadgets')
        .get(listGadgets)
        .all(audit('(x)'))
        .delete(removeGadgets);
      router.route('/plain').all(onlyMiddleware);
      router.get('/after', h);
    `;

    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/after' },
      { method: 'GET', path: '/widgets' },
      { method: 'POST', path: '/widgets' },
      { method: 'GET', path: '/gadgets' },
      { method: 'DELETE', path: '/gadgets' },
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
  it('keeps a mount whose router is an inline require() with a property access', () => {
    const source = "app.use('/a', require('./a').router);";
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/a', requirePath: './a', exportName: 'router' },
    ]);
  });

  it('keeps mounts whose router is an inline require(), mixed with identifier mounts', () => {
    const source = [
      "const usersRouter = require('./users.routes');",
      "app.use('/users', usersRouter);",
      "app.use('/x', require('./y'));",
      "app.use(\"/z\", requireAuth(), require(\"./z.routes\"));",
      "app.use(express.json());",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/users', requirePath: './users.routes' },
      { prefix: '/x', requirePath: './y' },
      { prefix: '/z', requirePath: './z.routes' },
    ]);
  });

  it('keeps a mount whose middleware is a call expression, e.g. authorize("admin")', () => {
    const source = [
      "const adminRouter = require('./admin.routes');",
      "app.use('/admin', requireAuth(), authorize('admin', 'ops'), adminRouter);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/admin', requirePath: './admin.routes' },
    ]);
  });

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
  it('reports an array-path router.<verb>([...]) call as unparsed instead of silently dropping it', () => {
    const source = "router.get('/', list);\nrouter.get(['/a', '/b'], h);\nrouter.use(['/x', '/y'], sub);";

    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/' }]);
    expect(findUnparsedRoutes(source).map((f) => [f.method, f.line])).toEqual([
      ['GET', 2],
      ['MOUNT', 3],
    ]);
  });

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

describe('parseRouterSource settings getter', () => {
  it("does not read app.get('env') / req.app.get('title') (Express settings getter) as a route", () => {
    const source = `
      if (app.get('env') === 'production') {}
      const title = req.app.get('title');
      router.get('/a', h);
      app.get('*', fallback);
    `;
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'GET', path: '*' },
    ]);
  });
});

describe('route-shaped text inside a string/template literal', () => {
  it('does not read a call quoted inside a string or template literal as a live route', () => {
    const source = [
      "const msg = \"router.get('/ghost', h)\";",
      'const tpl = `app.post(\'/ghost2\', h)`;',
      "router.get('/real', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/real' }]);
  });

  it('does not read a quoted app.use mount, require, or .route chain as live', () => {
    const source = [
      "const doc = \"app.use('/ghost', require('./ghost'))\";",
      "const doc2 = \"router.route('/ghost2').get(h)\";",
      "app.use('/real', require('./real'));",
    ].join('\n');
    expect(parseAppEntrySource(source)).toEqual({
      directRoutes: [],
      mounts: [{ prefix: '/real', requirePath: './real' }],
    });
  });

  it('does not report a quoted template-literal route as unparsed', () => {
    const source = 'const doc = "router.get(`/x/${v}`, h)";';
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});

describe('parseAppEntrySource prefixless mounts (task 37)', () => {
  it('resolves a prefixless identifier mount to an empty prefix', () => {
    const source = "app.use(r5);\nconst r5 = require('./r5');";
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '', requirePath: './r5' }]);
  });

  it('resolves a prefixless inline-require mount, with or without a property access', () => {
    const source = "app.use(require('./routes/a'));\nrouter.use(require('./routes/b').router);";
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '', requirePath: './routes/a' },
      { prefix: '', requirePath: './routes/b', exportName: 'router' },
    ]);
  });

  it('tolerates middleware args before a prefixless router', () => {
    const source = [
      "const auth = require('./middleware/auth');",
      "const things = require('./routes/things');",
      "app.use(auth, authorize('admin'), things);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '', requirePath: './routes/things' }]);
  });

  it('keeps prefixed and prefixless mounts apart, each resolved to its own file', () => {
    const source = [
      "const a = require('./a');",
      "const b = require('./b');",
      "app.use('/api/a', a);",
      'app.use(b);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/api/a', requirePath: './a' },
      { prefix: '', requirePath: './b' },
    ]);
  });

  it('produces no mount for a call-expression middleware, an inline function, or a bare-package identifier', () => {
    const source = [
      "const express = require('express');",
      "const helmet = require('helmet');",
      'app.use(express.json());',
      'app.use(helmet);',
      "app.use(require('cors'));",
      'app.use((req, res) => res.status(404).end());',
      'app.use(notRequiredHere);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
  });

  it('ignores a prefixless mount that is commented out or quoted inside a string', () => {
    const source = [
      "const r = require('./r');",
      '// app.use(r);',
      'const doc = "app.use(r)";',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
  });
});

describe('parseAppEntrySource mounts with a const-string prefix variable', () => {
  it('uses the string a const prefix variable is bound to, instead of treating it as middleware', () => {
    const source = [
      "const API = '/api/tasks';",
      "const tasks = require('./tasks.routes');",
      'app.use(API, tasks);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api/tasks', requirePath: './tasks.routes' }]);
  });

  it('resolves it with middleware args and an inline require, mixed with a real prefixless mount', () => {
    const source = [
      'const BASE = "/v1";',
      "const auth = require('./middleware/auth');",
      "const open = require('./open.routes');",
      "app.use(BASE, auth, require('./things.routes'));",
      'app.use(auth, open);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/v1', requirePath: './things.routes' },
      { prefix: '', requirePath: './open.routes' },
    ]);
  });

  it('does not take a prefix from a non-literal initializer, a commented-out const, or a later argument', () => {
    // Task 38: `A` is bound to a non-literal expression, so its mount is
    // dropped (and warned about) rather than mounted at ''.
    const source = [
      "const A = '/a' + suffix;",
      "// const B = '/b';",
      "const C = '/c';",
      "const r = require('./r');",
      'app.use(A, r);',
      'app.use(B, r);',
      'app.use(mw, C, r);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '', requirePath: './r' },
      { prefix: '', requirePath: './r' },
    ]);
    expect(findUnparsedRoutes(source).map((f) => [f.method, f.line])).toEqual([['MOUNT', 5]]);
  });
});

describe('mounts whose prefix variable is a non-literal expression (task 38)', () => {
  const WARNING = (line) => ({
    type: 'unparsed-route',
    method: 'MOUNT',
    line,
    reason: 'mount exists but prefix could not be statically resolved',
  });

  it('warns and does not mount for an env-fallback const prefix', () => {
    const source = [
      "const API = process.env.API_PREFIX || '/api';",
      "const tasks = require('./tasks.routes');",
      'app.use(API, tasks);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([WARNING(3)]);
  });

  it('warns and does not mount for a template-literal const prefix, with middleware and an inline require', () => {
    const source = [
      'const API = `/api/${version}`;',
      "const auth = require('./middleware/auth');",
      "app.use(API, auth, require('./tasks.routes'));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([WARNING(3)]);
  });

  it('warns for a reassignable let/var string prefix and an initializer on the next line', () => {
    const source = [
      "let A = '/a';",
      'var B =',
      '  config.prefix;',
      "const r = require('./r');",
      'app.use(A, r);',
      'router.use(B, r);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([WARNING(5), WARNING(6)]);
  });

  it('still mounts at an empty prefix when the first argument is middleware', () => {
    const source = [
      "const viaRequire = require('./middleware/auth');",
      'function viaDeclaration(req, res, next) { next(); }',
      'const viaArrow = (req, res, next) => next();',
      'const viaAsyncArrow = async (req, res, next) => next();',
      'const viaFunction = function (req, res, next) { next(); };',
      'const viaFactory = rateLimit({ max: 5 });',
      'const viaNew = new Limiter();',
      "const r = require('./r');",
      'app.use(viaRequire, r);',
      'app.use(viaDeclaration, r);',
      'app.use(viaArrow, r);',
      'app.use(viaAsyncArrow, r);',
      'app.use(viaFunction, r);',
      'app.use(viaFactory, r);',
      'app.use(viaNew, r);',
      'app.use(unbound, r);',
      'app.use(config.apiPrefix, r);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual(Array(9).fill({ prefix: '', requirePath: './r' }));
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('does not warn when the unresolvable name is not the first of several arguments', () => {
    const source = [
      "const API = process.env.API_PREFIX || '/api';",
      "const r = require('./r');",
      'app.use(API);',
      'app.use(mw, API, r);',
    ].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('ignores a commented-out or quoted binding and a commented-out mount', () => {
    const source = [
      "// const A = process.env.A || '/a';",
      'const doc = "const B = process.env.B";',
      "const C = process.env.C || '/c';",
      "const r = require('./r');",
      'app.use(A, r);',
      'app.use(B, r);',
      '// app.use(C, r);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '', requirePath: './r' },
      { prefix: '', requirePath: './r' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('keeps a const-string prefix mount and a real prefixless mount in the same file', () => {
    const source = [
      "const V1 = '/v1';",
      "const V2 = process.env.V2_PREFIX || '/v2';",
      "const auth = require('./middleware/auth');",
      "const a = require('./a.routes');",
      "const b = require('./b.routes');",
      "const c = require('./c.routes');",
      'app.use(V1, a);',
      'app.use(V2, b);',
      'app.use(auth, c);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/v1', requirePath: './a.routes' },
      { prefix: '', requirePath: './c.routes' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([WARNING(8)]);
  });

  it('does not resolve a const string literal that continues as a multi-line expression', () => {
    for (const continuation of ["  + '/b';", '  + version;', '  || fallback;']) {
      const source = [
        "const r = require('./r');",
        "const API = '/a' // base",
        continuation,
        'app.use(API, r);',
      ].join('\n');
      expect(parseAppEntrySource(source).mounts).toEqual([]);
      expect(findUnparsedRoutes(source)).toEqual([WARNING(4)]);
    }
  });

  it('still resolves a semicolon-less const string followed by an unrelated statement', () => {
    const source = [
      "const r = require('./r')",
      "const API = '/api'",
      '',
      'app.use(API, r)',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './r' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('treats an awaited factory call as middleware, like the un-awaited call', () => {
    const source = [
      "const r = require('./r');",
      'const mw = await buildMiddleware();',
      'app.use(mw, r);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '', requirePath: './r' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});

describe('mounts whose prefix is an inline non-literal expression (task 39)', () => {
  const WARNING = (line) => ({
    type: 'unparsed-route',
    method: 'MOUNT',
    line,
    reason: 'mount exists but prefix could not be statically resolved',
  });

  it.each([
    ["app.use(API + '/v1', r);"],
    ["app.use('/api' + version, r);"],
    ["app.use(process.env.API_PREFIX || '/api', r);"],
    ["app.use(config.prefix ?? '/api', r);"],
    ["app.use(isV2 ? '/v2' : '/v1', auth, r);"],
    ["router.use(\n  base + '/x',\n  r\n);"],
  ])('warns once and mounts nothing for %s', (call) => {
    const source = ["const r = require('./r');", '', call].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([WARNING(3)]);
  });

  it('does not warn for a single-argument middleware selection', () => {
    for (const call of ['app.use(customMw || defaultMw);', 'app.use(isProd ? limiter : noop);']) {
      expect(findUnparsedRoutes(call)).toEqual([]);
    }
  });

  it('ignores an operator nested inside a call, object or array in the first argument', () => {
    const source = [
      "const r = require('./r');",
      'app.use(mw({ a: 1 + 2 }), r);',
      'app.use(pick(a || b, [c ? d : e]), r);',
      'app.use(config?.auth, r);',
    ].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([]);
    // Task 40: the optional-chained member is middleware like any dotted
    // member, so its router mounts at '' too (it used to vanish silently).
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '', requirePath: './r' },
      { prefix: '', requirePath: './r' },
      { prefix: '', requirePath: './r' },
    ]);
  });

  it('does not warn when the operator is in a later argument or the prefix is a literal', () => {
    const source = [
      "const r = require('./r');",
      "app.use('/api', r);",
      "app.use('/a', flag ? r : other);",
      'app.use(auth, a || b);',
    ].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('ignores the same text inside a comment or a string', () => {
    const source = [
      "const r = require('./r');",
      "// app.use(API + '/v1', r);",
      "/* app.use('/api' + v, r); */",
      'log("app.use(API + \'/v1\', r)");',
      "log(`app.use(P || '/api', r)`);",
    ].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('is not fooled by an operator or comma inside a string or comment in the arguments', () => {
    const source = [
      "const r = require('./r');",
      "app.use('/a+b,c', r);",
      'app.use(auth /* a || b, */, r);',
      "app.use(API /* , */ + '/v1' // x || y",
      '  , r);',
    ].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([WARNING(4)]);
  });

  it('warns per occurrence, mixed with resolvable mounts, without doubling a template-literal warning', () => {
    const source = [
      "const a = require('./a');",
      "const b = require('./b');",
      "app.use('/a', a);",
      "app.use(API + '/b', b);",
      'app.use(`/c/${v}` + x, b);',
      "app.use(P || '/d', b);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/a', requirePath: './a' }]);
    expect(findUnparsedRoutes(source).map((f) => [f.method, f.line]).sort()).toEqual([
      ['MOUNT', 4],
      ['MOUNT', 5],
      ['MOUNT', 6],
    ]);
  });

  it('skips an unterminated use( call instead of throwing', () => {
    expect(findUnparsedRoutes("app.use(API + '/v1', r")).toEqual([]);
  });

  // Reviewer 2026-11-10: MOUNT_PATTERN's lazy prefix capture ran past the
  // first literal's closing quote to a later one, so a concatenation of two
  // literals was mounted at the garbage prefix "/api' + '/v1".
  it.each([
    ["app.use('/api' + '/v1', r);"],
    ["app.use('/api' + v, r); app.use('/ok' + w, r);"],
    ['app.use("/api" + "/v1", auth, r);'],
  ])('never mounts at a prefix spanning two string literals for %s', (call) => {
    const source = ["const r = require('./r');", '', call].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source).length).toBeGreaterThan(0);
  });

  it('still mounts a literal prefix that follows an expression-prefix mount on the same line', () => {
    const source = ["const r = require('./r');", "app.use('/api' + v, r); app.use('/ok', r);"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/ok', requirePath: './r' }]);
    expect(findUnparsedRoutes(source)).toEqual([WARNING(2)]);
  });

  it('keeps a prefix containing the other quote character', () => {
    const source = ["const r = require('./r');", 'app.use("/it\'s", r);'].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: "/it's", requirePath: './r' }]);
  });

  // Reviewer 2026-11-10: a trailing comma (Prettier's default for a call
  // broken over several lines) was counted as a second argument.
  it('does not count a trailing comma as a second argument', () => {
    for (const call of ['app.use(\n  customMw || defaultMw,\n);', 'app.use(isProd ? limiter : noop, );']) {
      expect(findUnparsedRoutes(call)).toEqual([]);
    }
  });

  it('still warns for a two-argument mount written with a trailing comma', () => {
    const source = ["const r = require('./r');", '', "app.use(\n  API + '/v1',\n  r,\n);"].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([WARNING(3)]);
  });
});

describe('mounts with arbitrary middle arguments and chained use() (task 40)', () => {
  const MOUNT_WARNING = {
    type: 'unparsed-route',
    method: 'MOUNT',
    reason: 'mount exists but prefix could not be statically resolved',
  };

  it.each([
    ['an inline arrow function', "app.use('/api', (req, res, next) => next(), r);"],
    ['an inline function expression', "app.use('/api', function (q, s, n) { n(); }, r);"],
    ['an array of middleware', "app.use('/api', [auth, limiter], r);"],
    ['an inline expression', "app.use('/api', customMw || defaultMw, r);"],
  ])('mounts at the prefix when a middle argument is %s', (_label, call) => {
    const source = ["const r = require('./r');", "const plain = require('./plain');", "app.use('/plain', plain);", call].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/plain', requirePath: './plain' },
      { prefix: '/api', requirePath: './r' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts every call of a chained use(), including across lines and comments', () => {
    const source = [
      "const r = require('./r');",
      "const r2 = require('./r2');",
      "const r3 = require('./r3');",
      "app.use('/plain', r3);",
      "app.use('/api', r).use('/b', r2)",
      '  // still the same chain',
      "  .use(require('./r4'));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/plain', requirePath: './r3' },
      { prefix: '/api', requirePath: './r' },
      { prefix: '/b', requirePath: './r2' },
      { prefix: '', requirePath: './r4' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('warns on the right line for an unresolvable prefix in a chained use()', () => {
    const source = [
      "const r = require('./r');",
      "app.use('/api', r)",
      "  .use(base + '/v2', r);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './r' }]);
    expect(findUnparsedRoutes(source)).toEqual([{ ...MOUNT_WARNING, line: 3 }]);
  });

  it('does not treat a .use( on an unrelated receiver as a chained mount', () => {
    const source = ["const r = require('./r');", "app.use('/api', r);", "other.use('/b', r);"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './r' }]);
  });

  it('ignores commas, parens and quotes inside inline middleware bodies', () => {
    const source = [
      "const r = require('./r');",
      "app.use('/api', (req, res, next) => { log('a, b) \\' (', \"x)\", `t, ${req.id})`); /* ), */ next(); }, r);",
      "app.use('/v2', function (q, s, n) { if (q.a ? 1 : 0) { s.send(')'); } n(); }, [a, b], r);",
      "app.use((req, res, next) => (req.ok ? next() : res.end()), r);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/api', requirePath: './r' },
      { prefix: '/v2', requirePath: './r' },
      { prefix: '', requirePath: './r' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('resolves a const-string prefix and an inline require router around odd middleware', () => {
    const source = [
      "const API = '/api';",
      "app.use(API, [auth], (q, s, n) => n(), require('./r').router);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './r', exportName: 'router' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('still produces no mount and no warning for plain middleware calls', () => {
    const source = [
      "const express = require('express');",
      "app.use('/api', express.json());",
      "app.use('/static', express.static('public'));",
      "app.use('/api', (req, res, next) => next());",
      'app.use(express.json()).use(helmet());',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('warns instead of dropping a relative router behind a prefix it cannot read', () => {
    const source = [
      "const r = require('./r');",
      "app.use(/^\\/api/, r);",
      "app.use('/it\\'s', r);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([
      { ...MOUNT_WARNING, line: 2 },
      { ...MOUNT_WARNING, line: 3 },
    ]);
  });

  it('ignores a use() call quoted in a string or sitting in a comment', () => {
    const source = [
      "const r = require('./r');",
      '// app.use(\'/dead\', () => {}, r);',
      'const hint = "app.use(\'/quoted\', [a], r)";',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});

// Reviewer 2026-11-10 (~23:40 UTC), review of task 40 (f91333e).
describe('chained and receiver-on-its-own-line use()/verb calls', () => {
  const MOUNT_WARNING = {
    type: 'unparsed-route',
    method: 'MOUNT',
    reason: 'mount exists but prefix could not be statically resolved',
  };

  it('warns for a chained use() whose prefix is a template literal or an array', () => {
    // resolvePrefix left these to UNPARSED_MOUNT_PATTERN, which only matches
    // a use( written directly on app|router -- so the chained form vanished.
    const source = [
      "const r = require('./r');",
      'app.use(helmet()).use(`/api/${v}`, r);',
      'app.use(helmet())',
      "  .use(['/a', '/b'], r);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([
      { ...MOUNT_WARNING, line: 2 },
      { ...MOUNT_WARNING, line: 4 },
    ]);
  });

  it('still warns exactly once for a template-literal prefix written directly on app', () => {
    const source = ["const r = require('./r');", 'app.use(`/api/${v}`, r).use(`/b/${v}`, r);'].join('\n');
    expect(findUnparsedRoutes(source)).toEqual([
      { ...MOUNT_WARNING, line: 2 },
      { ...MOUNT_WARNING, line: 2 },
    ]);
  });

  it('reads a use() chain whose receiver sits on its own line', () => {
    const source = [
      "const r = require('./r');",
      "const r2 = require('./r2');",
      'app',
      '  .use(helmet())',
      "  .use('/api', r)",
      '  // .use(\'/dead\', r2)',
      '  .use(`/x/${v}`, r2);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './r' }]);
    expect(findUnparsedRoutes(source)).toEqual([{ ...MOUNT_WARNING, line: 7 }]);
  });

  it('reads a verb or unparsed verb call whose receiver sits on its own line', () => {
    const source = ['router', "  .get('/x', h);", 'router', '  .post(`/y/${id}`, h);'].join('\n');
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/x' }]);
    expect(findUnparsedRoutes(source)).toEqual([
      {
        type: 'unparsed-route',
        method: 'POST',
        line: 3,
        reason: 'route exists but path could not be statically resolved',
      },
    ]);
  });

  it('does not treat an unrelated .use on a later line as an app call', () => {
    const source = ["const r = require('./r');", 'const app = express();', "other.use('/api', r);"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});

describe('mounts whose router is a member of a require binding or a destructured require (task 41)', () => {
  const MOUNT_WARNING = {
    type: 'unparsed-route',
    method: 'MOUNT',
    reason: 'mount exists but prefix could not be statically resolved',
  };

  it('mounts a member of a relative-require binding, with a prefix', () => {
    const source = ["const routes = require('./routes');", "app.use('/api', routes.tasks);"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './routes', exportName: 'tasks' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts a destructured relative require, with a prefix', () => {
    const source = ["const { tasks } = require('./routes');", "app.use('/api', tasks);"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api', requirePath: './routes', exportName: 'tasks' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts both shapes without a prefix and behind middle middleware', () => {
    const source = [
      "const routes = require('./routes');",
      "const { users, auth: authRouter } = require('./more');",
      'app.use(routes.tasks);',
      'app.use(users);',
      "app.use('/a', requireAuth(), (req, res, next) => next(), routes.admin);",
      "app.use('/b', [limiter, audit], authRouter);",
      'app.use(requireAuth, routes?.tasks);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '', requirePath: './routes', exportName: 'tasks' },
      { prefix: '', requirePath: './more', exportName: 'users' },
      { prefix: '/a', requirePath: './routes', exportName: 'admin' },
      { prefix: '/b', requirePath: './more', exportName: 'auth' },
      { prefix: '', requirePath: './routes', exportName: 'tasks' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('reads a destructure spread over several lines, with defaults, a rest element and comments', () => {
    const source = [
      'const {',
      '  tasks, // the main router',
      '  users: usersRouter = fallback,',
      '  ...others',
      "} = require('./routes');",
      "app.use('/t', tasks);",
      "app.use('/u', usersRouter);",
      "app.use('/o', others);",
      "app.use('/x', users);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/t', requirePath: './routes', exportName: 'tasks' },
      { prefix: '/u', requirePath: './routes', exportName: 'users' },
      { prefix: '/o', requirePath: './routes' },
    ]);
  });

  it('warns instead of dropping the router when the prefix cannot be resolved', () => {
    const source = [
      "const routes = require('./routes');",
      "const { tasks } = require('./routes');",
      "app.use(API + '/v1', routes.tasks);",
      'app.use(/^\\/api/, tasks);',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([
      { ...MOUNT_WARNING, line: 3 },
      { ...MOUNT_WARNING, line: 4 },
    ]);
  });

  it('gives no mount and no warning for a bare-package destructure or member', () => {
    const source = [
      "const express = require('express');",
      "const { Router, json } = require('express');",
      "const swaggerUi = require('swagger-ui-express');",
      "app.use('/api', express.json);",
      "app.use('/api', json);",
      'app.use(Router);',
      "app.use('/docs', swaggerUi.serve);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  // A member call of a relative-require binding (`routes.build()`) was part of
  // this fixture until task 44, which resolves it as a router factory call.
  it('leaves a member of a non-require binding, a deeper member and its call unchanged', () => {
    const source = [
      "const routes = require('./routes');",
      'const local = { tasks: makeRouter() };',
      "app.use('/a', local.tasks);",
      "app.use('/b', routes.v1.tasks);",
      "app.use('/c', routes.v1.build());",
      "app.use('/d', unknown.tasks);",
      "app.use('/e', local.tasks());",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts a member call of a relative-require binding as a router factory (task 44)', () => {
    const source = ["const routes = require('./routes');", "app.use('/c', routes.build());"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/c', requirePath: './routes', exportName: 'build' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('ignores a commented-out or quoted destructured require', () => {
    const source = [
      "// const { tasks } = require('./routes');",
      "const text = \"const { users } = require('./routes');\";",
      "app.use('/t', tasks);",
      "app.use('/u', users);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
  });
});

describe('findExportedRequire: a barrel file\'s named export (task 43)', () => {
  it('reads a require written inline in module.exports', () => {
    const source = "module.exports = {\n  tasks: require('./tasks.routes'),\n  users: require('./users.routes').router,\n};";
    expect(findExportedRequire(source, 'tasks')).toEqual({ requirePath: './tasks.routes', exportName: null });
    expect(findExportedRequire(source, 'users')).toEqual({ requirePath: './users.routes', exportName: 'router' });
    expect(findExportedRequire(source, 'missing')).toBeNull();
  });

  it('reads a shorthand or renamed local bound by, or destructured from, a relative require', () => {
    const source = [
      "const tasks = require('./tasks.routes');",
      "const usersRouter = require('./users.routes');",
      "const { admin: adminRouter } = require('./admin');",
      "module.exports = { tasks, users: usersRouter, 'admin': adminRouter, build() { return 1; }, ...rest };",
    ].join('\n');
    expect(findExportedRequire(source, 'tasks')).toEqual({ requirePath: './tasks.routes', exportName: null });
    expect(findExportedRequire(source, 'users')).toEqual({ requirePath: './users.routes', exportName: null });
    expect(findExportedRequire(source, 'admin')).toEqual({ requirePath: './admin', exportName: 'admin' });
    expect(findExportedRequire(source, 'build')).toBeNull();
    expect(findExportedRequire(source, 'rest')).toBeNull();
  });

  it('reads exports.name and module.exports.name assignments', () => {
    const source = [
      "const users = require('./users.routes');",
      "exports.tasks = require('./tasks.routes');",
      'module.exports.users = users',
      "exports.multi =\n  require('./multi.routes');",
    ].join('\n');
    expect(findExportedRequire(source, 'tasks')).toEqual({ requirePath: './tasks.routes', exportName: null });
    expect(findExportedRequire(source, 'users')).toEqual({ requirePath: './users.routes', exportName: null });
    expect(findExportedRequire(source, 'multi')).toEqual({ requirePath: './multi.routes', exportName: null });
  });

  it('returns null for a router built in the same file, a bare package and a non-require value', () => {
    const source = [
      "const express = require('express');",
      'const router = express.Router();',
      "const helmet = require('helmet');",
      "module.exports = { router, helmet, json: express.json, made: makeRouter(require('./x')) };",
      'exports.other = router;',
      "exports.eq == require('./eq');",
    ].join('\n');
    for (const name of ['router', 'helmet', 'json', 'made', 'other', 'eq']) {
      expect(findExportedRequire(source, name)).toBeNull();
    }
  });

  it('ignores a commented-out or quoted export', () => {
    const source = [
      "// exports.tasks = require('./old.routes');",
      "const text = \"module.exports = { users: require('./old.routes') }\";",
      'module.exports = {',
      "  // tasks: require('./older.routes'),",
      "  tasks: require('./tasks.routes'), /* users: require('./old.routes') */",
      '};',
    ].join('\n');
    expect(findExportedRequire(source, 'tasks')).toEqual({ requirePath: './tasks.routes', exportName: null });
    expect(findExportedRequire(source, 'users')).toBeNull();
  });
});

describe('findExportHops: wholesale barrels (task 46)', () => {
  it('answers a whole-module re-export for a whole-module and a named lookup', () => {
    const source = "module.exports = require('./all');";
    expect(findExportHops(source, null)).toEqual([{ requirePath: './all', exportName: null, via: 'module' }]);
    expect(findExportHops(source, 'tasks')).toEqual([{ requirePath: './all', exportName: 'tasks', via: 'module' }]);
  });

  it('answers a member re-export for a whole-module lookup only', () => {
    const source = "const all = require('./all');\nmodule.exports = all.routers";
    expect(findExportHops(source, null)).toEqual([{ requirePath: './all', exportName: 'routers', via: 'module' }]);
    expect(findExportHops(source, 'tasks')).toEqual([]);
  });

  it('lists spreads last-written first, across module.exports and Object.assign objects', () => {
    const source = "const b = require('./b');\nmodule.exports = { ...require('./a'), own: 1, ...b, ...require('pkg'), ...other };\nObject.assign(exports, { ...require('./c') });";
    expect(findExportHops(source, 'tasks').map((hop) => hop.requirePath)).toEqual(['./c', './b', './a']);
    expect(findExportHops(source, 'tasks').every((hop) => hop.via === 'spread' && hop.exportName === 'tasks')).toBe(true);
    expect(findExportHops(source, null)).toEqual([]);
  });

  it('gives no spread or whole-module hop for a name the file declares itself', () => {
    const source = "module.exports = { ...require('./a'), tasks: router };";
    expect(findExportHops(source, 'tasks')).toEqual([]);
    expect(declaresExport(source, 'tasks')).toBe(true);
    expect(declaresExport(source, 'users')).toBe(false);
    expect(declaresExport("exports.users = make();", 'users')).toBe(true);
  });

  it('reads Object.assign object-literal arguments as named exports, and keeps findExportedRequire to named hops', () => {
    const source = "Object.assign(module.exports, { a: fn(1, 2) }, { tasks: require('./tasks.routes') });";
    expect(findExportHops(source, 'tasks')).toEqual([{ requirePath: './tasks.routes', exportName: null, via: 'named' }]);
    expect(findExportedRequire(source, 'tasks')).toEqual({ requirePath: './tasks.routes', exportName: null });
    expect(findExportedRequire("module.exports = require('./all');", 'tasks')).toBeNull();
    expect(findExportedRequire("module.exports = { ...require('./all') };", 'tasks')).toBeNull();
  });

  it('ignores Object.assign onto anything but the exports object, and commented-out or quoted text', () => {
    const sources = [
      "Object.assign(target, { tasks: require('./tasks.routes') });",
      "// Object.assign(module.exports, { tasks: require('./tasks.routes') });",
      "const s = \"module.exports = require('./all');\";",
      "/* module.exports = { ...require('./all') }; */",
    ];
    for (const source of sources) {
      expect(findExportHops(source, 'tasks')).toEqual([]);
      expect(findExportHops(source, null)).toEqual([]);
    }
  });
});

describe('verb calls chained onto a verb or use() call (task 42)', () => {
  it('reads every verb of a single-line chain', () => {
    const source = "router.get('/a', h).post('/b', h).delete('/c/:id', h);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
      { method: 'DELETE', path: '/c/:id' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('reads a multi-line chain with the receiver on its own line', () => {
    const source = [
      'router',
      "  .get('/a', h)",
      "  .post('/b', auth, (req, res) => { res.json({ ok: ')' }); })",
      "  .put('/c', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
      { method: 'PUT', path: '/c' },
    ]);
  });

  it('reads a verb chained onto use(), and a use() chained onto a verb', () => {
    const source = [
      "const r = require('./r.routes');",
      "const s = require('./s.routes');",
      "app.use('/api', r).get('/health', h).use('/s', s).post('/echo', h);",
    ].join('\n');
    const { directRoutes, mounts } = parseAppEntrySource(source);
    expect(directRoutes).toEqual([
      { method: 'GET', path: '/health' },
      { method: 'POST', path: '/echo' },
    ]);
    expect(mounts).toEqual([
      { prefix: '/api', requirePath: './r.routes' },
      { prefix: '/s', requirePath: './s.routes' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('skips a commented-out link and keeps reading the chain past it', () => {
    const source = [
      'router',
      "  .get('/a', h)",
      "  // .post('/dead', h)",
      "  /* .patch('/dead2', h) */",
      "  .put('/c', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'PUT', path: '/c' },
    ]);
  });

  it('warns for a chained verb with a template-literal or array path', () => {
    const source = [
      "router.get('/a', h)",
      '  .post(`/b/${v}`, h)',
      "  .put(['/c', '/d'], h)",
      "  .delete('/e', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'DELETE', path: '/e' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([
      { type: 'unparsed-route', method: 'POST', line: 2, reason: 'route exists but path could not be statically resolved' },
      { type: 'unparsed-route', method: 'PUT', line: 3, reason: 'route exists but path could not be statically resolved' },
    ]);
  });

  it('warns for a use() with a template-literal prefix chained onto a verb', () => {
    const source = [
      "const r = require('./r.routes');",
      "app.get('/health', h).use(`/api/${v}`, r);",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([
      { type: 'unparsed-route', method: 'MOUNT', line: 2, reason: 'mount exists but prefix could not be statically resolved' },
    ]);
  });

  it('continues past a chained .all() without adding a route for it', () => {
    const source = "router.get('/a', h).all('/b', mw).post('/b', h);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
    ]);
  });

  it('does not treat a separate statement or an unrelated call as part of the chain', () => {
    const source = [
      "router.get('/a', h);",
      "other.post('/not-a-route', h);",
      "client.get('/x').post('/y', h);",
      "router.get('/b', h).listen(3000).post('/after-unknown-link', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'GET', path: '/b' },
    ]);
  });

  it('ignores a chained settings getter and a chain quoted in a string', () => {
    const source = [
      "app.use(helmet()).get('env');",
      "const text = \"router.get('/a', h).post('/b', h)\";",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('still reads a .route() chain exactly once', () => {
    const source = "router.route('/a').get(h).post(h);\nrouter.get('/b', h).route('/c').put(h);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/b' },
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/a' },
      { method: 'PUT', path: '/c' },
    ]);
  });
});

describe('mounts whose router is built by calling a factory from a relative require (task 44)', () => {
  const MOUNT_WARNING = {
    type: 'unparsed-route',
    method: 'MOUNT',
    reason: 'mount exists but prefix could not be statically resolved',
  };

  it('mounts a call of a relative-require binding', () => {
    const source = ["const makeTasksRouter = require('./tasks.routes');", "app.use('/api/tasks', makeTasksRouter(db));"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '/api/tasks', requirePath: './tasks.routes' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts a call of an inline relative require, with and without a member', () => {
    const source = [
      "app.use('/api/tasks', require('./tasks.routes')(db));",
      "app.use('/api/users', require(\"./routes\").users(db));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/api/tasks', requirePath: './tasks.routes' },
      { prefix: '/api/users', requirePath: './routes', exportName: 'users' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts a call of a member of, or a name destructured from, a relative require', () => {
    const source = [
      "const routes = require('./routes');",
      "const { makeUsers, admin: makeAdmin } = require('./more');",
      "app.use('/a', routes.tasks(db));",
      "app.use('/b', makeUsers(db));",
      "app.use('/c', makeAdmin());",
      "app.use('/d', routes?.tasks(db));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/a', requirePath: './routes', exportName: 'tasks' },
      { prefix: '/b', requirePath: './more', exportName: 'makeUsers' },
      { prefix: '/c', requirePath: './more', exportName: 'admin' },
      { prefix: '/d', requirePath: './routes', exportName: 'tasks' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('mounts every callee form without a prefix and behind middle middleware', () => {
    const source = [
      "const makeTasksRouter = require('./tasks.routes');",
      "const routes = require('./routes');",
      "const { makeUsers } = require('./more');",
      'app.use(makeTasksRouter(db));',
      'app.use(routes.tasks(db));',
      "app.use(require('./x.routes')(db));",
      "app.use('/a', requireAuth(), (req, res, next) => next(), makeUsers(db));",
      "app.use('/b', [limiter, audit], makeTasksRouter(db));",
      'app.use(requireAuth, makeTasksRouter(db));',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '', requirePath: './tasks.routes' },
      { prefix: '', requirePath: './routes', exportName: 'tasks' },
      { prefix: '', requirePath: './x.routes' },
      { prefix: '/a', requirePath: './more', exportName: 'makeUsers' },
      { prefix: '/b', requirePath: './tasks.routes' },
      { prefix: '', requirePath: './tasks.routes' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('reads the callee past nested parens, commas, quotes and comments in the call arguments', () => {
    const source = [
      "const makeTasksRouter = require('./tasks.routes');",
      "app.use('/a', makeTasksRouter(db, { name: 'a, (b)', fn: (x, y) => get(x)[0] }, \"it's )\"));",
      "app.use('/b', makeTasksRouter(",
      '  db, // the (shared) pool',
      '  opts(1, 2),',
      '));',
      "app.use('/c', makeTasksRouter(db) /* built per app */);",
      "app.use('/d', makeTasksRouter (db));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([
      { prefix: '/a', requirePath: './tasks.routes' },
      { prefix: '/b', requirePath: './tasks.routes' },
      { prefix: '/c', requirePath: './tasks.routes' },
      { prefix: '/d', requirePath: './tasks.routes' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('gives no mount and no warning for a bare-package call, prefixed or not', () => {
    const source = [
      "const express = require('express');",
      "const helmet = require('helmet');",
      "const swaggerUi = require('swagger-ui-express');",
      "const { rateLimit } = require('express-rate-limit');",
      'app.use(express.json());',
      'app.use(helmet());',
      "app.use('/docs', swaggerUi.serve, swaggerUi.setup(doc));",
      "app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 100 }));",
      "app.use('/pkg', require('some-router-package')(db));",
      "app.use('/static', express.static('public'));",
      'app.use(unbound(db));',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('does not treat a non-call argument ending in a paren, or a call of a call, as a factory call', () => {
    const source = [
      "const makeTasksRouter = require('./tasks.routes');",
      "app.use('/a', (req, res) => makeTasksRouter(db));",
      "app.use('/b', (makeTasksRouter));",
      "app.use('/c', makeTasksRouter(db)(extra));",
      "app.use('/d', wrap(makeTasksRouter(db)));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('ignores a factory mount inside a comment or a string', () => {
    const source = [
      "const makeTasksRouter = require('./tasks.routes');",
      "// app.use('/a', makeTasksRouter(db));",
      "const note = \"app.use('/b', makeTasksRouter(db));\";",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('warns instead of mounting when the prefix in front of a factory call cannot be resolved', () => {
    const source = [
      "const makeTasksRouter = require('./tasks.routes');",
      "app.use(API + '/v1', makeTasksRouter(db));",
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([{ ...MOUNT_WARNING, line: 2 }]);
  });

  it('follows a relative middleware factory as a prefixless mount', () => {
    const source = ["const requireRole = require('./middleware/roles');", "app.use(requireRole('admin'));"].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([{ prefix: '', requirePath: './middleware/roles' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});

describe('verb calls whose path is not one whole string literal (task 45)', () => {
  const warning = (method, line) => ({
    type: 'unparsed-route',
    method,
    line,
    reason: 'route exists but path could not be statically resolved',
  });

  it('does not list a concatenated head path at its first operand, and warns', () => {
    const source = "router.get('/a' + suffix, h);";
    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 1)]);
  });

  it('does not list a concatenated chained path at its first operand, and warns', () => {
    const source = "router.get('/z', h).post('/a' + suffix, h);";
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/z' }]);
    expect(findUnparsedRoutes(source)).toEqual([warning('POST', 1)]);
  });

  it('resolves a head path held in a const bound to a single string literal', () => {
    const source = "const PATH = '/a';\nrouter.get(PATH, h);";
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/a' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('resolves a chained path held in a const bound to a single string literal', () => {
    const source = "const PATH = '/a';\nrouter.get('/z', h).post(PATH, h);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/z' },
      { method: 'POST', path: '/a' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('warns on a ternary path, head and chained', () => {
    const source = "router.get(c ? '/a' : '/b', h);\nrouter.get('/z', h)\n  .post(c ? '/a' : '/b', h);";
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/z' }]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 1), warning('POST', 3)]);
  });

  it('warns on a regex-literal path, head and chained', () => {
    const source = 'router.get(/^\\/a$/, h);\nrouter.get(\'/z\', h).post(/^\\/a$/, h);';
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/z' }]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 1), warning('POST', 2)]);
  });

  it('warns on an unbound identifier or a member path', () => {
    const source = "router.get(PATH, h);\nrouter.post(paths.create, h);\nrouter.get('/z', h).put(config.path, h);";
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/z' }]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 1), warning('POST', 2), warning('PUT', 3)]);
  });

  it('keeps listing plain literal routes mixed with all five shapes in one file', () => {
    const source = [
      "const PATH = '/const';",
      "router.get('/plain', h);",
      "router.get('/a' + suffix, h);",
      'router.post(PATH, h);',
      "router.put(c ? '/a' : '/b', h);",
      'router.delete(/^\\/a$/, h);',
      "router.get('/chain', h).post('/a' + suffix, h).put(PATH, h).patch(c ? '/a' : '/b', h).delete(/^\\/a$/, h);",
      "router.patch('/last', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/plain' },
      { method: 'POST', path: '/const' },
      { method: 'GET', path: '/chain' },
      { method: 'PATCH', path: '/last' },
      { method: 'PUT', path: '/const' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([
      warning('GET', 3),
      warning('PUT', 5),
      warning('DELETE', 6),
      warning('POST', 7),
      warning('PATCH', 7),
      warning('DELETE', 7),
    ]);
  });

  it('warns instead of resolving a let or reassigned path name', () => {
    const source = "let PATH = '/a';\nPATH = '/b';\nvar OTHER = '/c';\nrouter.get(PATH, h);\nrouter.get('/z', h).post(OTHER, h);";
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/z' }]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 4), warning('POST', 5)]);
  });

  it('warns on a const whose initializer is not a single string literal', () => {
    const source = "const PATH = '/a' + version;\nconst P2 = process.env.P || '/b';\nrouter.get(PATH, h);\nrouter.get(P2, h);";
    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 3), warning('GET', 4)]);
  });

  it('keeps the settings getter silent: fewer than two arguments, or a quoted non-path first argument', () => {
    const source = [
      "const KEY = 'env';",
      "app.get('env');",
      "app.get('view engine');",
      'app.get(KEY);',
      'app.get(name);',
      'app.get(`env`);',
      "app.get('title', fallback);",
      'app.get(KEY, fallback);',
      'app.get();',
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('still lists a single-argument literal or const path', () => {
    const source = "const PATH = '/b';\nrouter.get('/a');\nrouter.get(PATH);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'GET', path: '/b' },
    ]);
  });

  it('reads the first argument across a comment, a trailing comma and its own line', () => {
    const source = "router.get(/* list */ '/a', h);\nrouter.post(\n  '/b', // create\n  h,\n);\nrouter.put(PATH, h,);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([warning('PUT', 6)]);
  });

  it('keeps a literal path holding an escaped quote or a comma whole', () => {
    const source = "router.get('/a\\'b', h);\nrouter.get('/x,y', h).post(\"/it's\", h);";
    expect(parseRouterSource(source)).toEqual([
      { method: 'GET', path: "/a\\'b" },
      { method: 'GET', path: '/x,y' },
      { method: 'POST', path: "/it's" },
    ]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('gives nothing for the same text inside a comment or a string', () => {
    const source = [
      "// router.get('/a' + suffix, h);",
      '/* router.get(PATH, h); router.get(c ? 1 : 2, h); */',
      'const msg = "router.get(PATH, h)";',
      "const other = 'router.get(/^x$/, h).post(PATH, h)';",
      "// const PATH = '/a';",
      "router.get('/real', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/real' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });

  it('does not resolve a path name whose const binding is only in a comment', () => {
    const source = "// const PATH = '/a';\nrouter.get(PATH, h);";
    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 2)]);
  });

  it('lists a direct app route with a const path in an app entry file, mounts unchanged', () => {
    const source = "const HEALTH = '/health';\nconst tasks = require('./tasks.routes');\napp.get(HEALTH, h);\napp.use('/api', tasks);";
    expect(parseAppEntrySource(source)).toEqual({
      directRoutes: [{ method: 'GET', path: '/health' }],
      mounts: [{ prefix: '/api', requirePath: './tasks.routes' }],
    });
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});

describe('a const string name bound more than once in the file (review of task 45)', () => {
  const warning = (method, line) => ({
    type: 'unparsed-route',
    method,
    line,
    reason: 'route exists but path could not be statically resolved',
  });

  it('warns instead of listing every verb path at the last binding\'s value', () => {
    const source = [
      'function a() {',
      "  const P = '/a';",
      '  router.get(P, h);',
      '}',
      'function b() {',
      "  const P = '/b';",
      '  router.post(P, h);',
      '}',
      "router.put('/real', h);",
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([{ method: 'PUT', path: '/real' }]);
    expect(findUnparsedRoutes(source)).toEqual([warning('GET', 3), warning('POST', 7)]);
  });

  it('warns when the other binding of the name is not a const string at all', () => {
    const source = [
      "const P = '/a';",
      'function b(base) {',
      '  let P = base + suffix;',
      '  router.post(P, h);',
      '}',
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([]);
    expect(findUnparsedRoutes(source)).toEqual([warning('POST', 4)]);
  });

  it('does not mount two routers at the last same-named prefix const', () => {
    const source = [
      "const tasks = require('./tasks.routes');",
      'function a() {',
      "  const API = '/v1';",
      '  app.use(API, tasks);',
      '}',
      'function b() {',
      "  const API = '/v2';",
      '  app.use(API, tasks);',
      '}',
    ].join('\n');
    expect(parseAppEntrySource(source).mounts).toEqual([]);
    expect(findUnparsedRoutes(source).map((f) => f.line)).toEqual([4, 8]);
  });

  it('still resolves a name bound once, and ignores a second binding in a comment or string', () => {
    const source = [
      "const P = '/a';",
      "// const P = '/b';",
      'const msg = "const P = \'/c\';";',
      'router.get(P, h);',
    ].join('\n');
    expect(parseRouterSource(source)).toEqual([{ method: 'GET', path: '/a' }]);
    expect(findUnparsedRoutes(source)).toEqual([]);
  });
});
