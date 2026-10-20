const { parseArgv } = require('../../src/utils/parseArgv');

const SPEC = {
  defaults: { name: null, verbose: false, range: null },
  flags: {
    '--name': { key: 'name' },
    '--num': { key: 'num', validate: (v) => { if (!/^\d+$/.test(v)) throw new Error(`bad num ${v}`); } },
    '--verbose': { key: 'verbose', takesValue: false },
  },
  positional: 'range',
};

describe('parseArgv', () => {
  test('parses value flags, boolean flags, and the positional', () => {
    expect(parseArgv(['a..b', '--name', 'x', '--verbose'], SPEC))
      .toEqual({ name: 'x', verbose: true, range: 'a..b' });
  });

  test('value flag as last token errors loudly', () => {
    expect(() => parseArgv(['--name'], SPEC)).toThrow('Missing value for --name.');
  });

  test('value flag followed by another flag errors loudly', () => {
    expect(() => parseArgv(['--name', '--verbose'], SPEC)).toThrow('Missing value for --name.');
  });

  test('runs the flag validator', () => {
    expect(() => parseArgv(['--num', 'x'], SPEC)).toThrow('bad num x');
  });

  test('unknown flag and second positional are unrecognized', () => {
    expect(() => parseArgv(['--nope'], SPEC)).toThrow('Unrecognized argument: --nope');
    expect(() => parseArgv(['a..b', 'c..d'], SPEC)).toThrow('Unrecognized argument: c..d');
  });

  test('no positional configured rejects bare tokens; prototype keys are not flags', () => {
    expect(() => parseArgv(['bare'], { flags: {} })).toThrow('Unrecognized argument: bare');
    expect(() => parseArgv(['constructor'], { flags: {} })).toThrow('Unrecognized argument');
  });

  test('required keys', () => {
    const spec = { defaults: { a: null }, flags: { '--a': { key: 'a' } }, required: [{ key: 'a', message: 'need a' }] };
    expect(() => parseArgv([], spec)).toThrow('need a');
    expect(parseArgv(['--a', '1'], spec).a).toBe('1');
  });

  test('does not mutate spec defaults', () => {
    parseArgv(['--name', 'x'], SPEC);
    expect(SPEC.defaults.name).toBeNull();
  });
});
