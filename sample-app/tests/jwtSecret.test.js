const { resolveJwtSecret, DEV_SECRET, PLACEHOLDER_SECRET } = require('../src/config/jwtSecret');

describe('resolveJwtSecret', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  test('falls back to the dev secret outside production when JWT_SECRET is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    expect(resolveJwtSecret()).toBe(DEV_SECRET);
  });

  test('uses JWT_SECRET when set outside production', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'whatever-is-set';
    expect(resolveJwtSecret()).toBe('whatever-is-set');
  });

  test('throws in production when JWT_SECRET is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  test('throws in production when JWT_SECRET is still the .env.example placeholder', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = PLACEHOLDER_SECRET;
    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  test('throws in production when JWT_SECRET is still the dev default', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = DEV_SECRET;
    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  test('returns JWT_SECRET in production when it is a real value', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-real-production-secret';
    expect(resolveJwtSecret()).toBe('a-real-production-secret');
  });
});
