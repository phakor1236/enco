import 'dotenv/config';

import { createApp } from './app.js';
import { registerJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

// Fail fast on missing production hardening rather than silently serving
// refresh cookies over HTTP. JWT_SECRET length is enforced lazily by
// authService.getJwtSecret(). Lives in the boot entry (not createApp) so
// tests can still build the app under arbitrary NODE_ENV.
if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'true') {
  throw new Error(
    'COOKIE_SECURE must be set to "true" in production so refresh cookies carry the Secure flag',
  );
}

const port = Number(process.env.API_PORT ?? 4000);
const app = createApp();

const cronTasks = registerJobs();

const server = app.listen(port, () => {
  logger.info({ port }, 'API listening');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received — stopping cron jobs and closing server');
  for (const task of cronTasks) task.stop();
  server.close(() => process.exit(0));
});
