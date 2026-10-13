import 'dotenv/config';
import { bootstrap } from './app/bootstrap/backend-bootstrap';

// This is the executable entry point. Webpack rewrites require.main/module,
// so a CommonJS entry-point guard can silently skip startup in production.
void bootstrap().catch(() => {
  process.exitCode = 1;
});
