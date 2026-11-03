jest.mock('../src/config/db', () => ({ connectDB: jest.fn().mockResolvedValue({}) }));

describe('server start()', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('fails fast in production with a placeholder JWT_SECRET, before connecting to the DB', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me';
    const { connectDB } = require('../src/config/db');
    const { start } = require('../src/server');
    await expect(start()).rejects.toThrow(/JWT_SECRET/);
    expect(connectDB).not.toHaveBeenCalled();
  });
});
