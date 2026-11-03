const { createApp } = require('./app');
const { connectDB } = require('./config/db');
const { resolveJwtSecret } = require('./config/jwtSecret');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sample-app';

async function start() {
  // Fail fast on a missing/placeholder production secret instead of booting and
  // returning 500s on the first login/authenticated request.
  resolveJwtSecret();
  await connectDB(MONGO_URI);
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`sample-app listening on port ${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { start };
