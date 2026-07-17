// Process entrypoint (`node dist/index.js`). Tests import `buildServer` from
// server.ts directly and drive it with Fastify's `.inject()` — no real listener,
// so this file's side effect (actually binding a port) never runs under test.
import { buildServer } from './server.js';

const { app, env } = await buildServer();
try {
  // 127.0.0.1 not 0.0.0.0: on-prem deployment sits behind a reverse proxy on the
  // same host (ADR-0005); binding all interfaces isn't needed and some sandboxed
  // dev environments (this one included) reject 0.0.0.0 with EACCES outright.
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
