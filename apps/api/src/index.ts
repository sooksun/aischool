// Process entrypoint (`node dist/index.js`). Tests import `buildServer` from
// server.ts directly and drive it with Fastify's `.inject()` — no real listener,
// so this file's side effect (actually binding a port) never runs under test.
import { buildServer } from './server.js';

const { app, env } = await buildServer();
try {
  // HOST defaults to 127.0.0.1: a bare-metal api sits behind a reverse proxy on
  // the same host (ADR-0005), and some sandboxed dev environments reject 0.0.0.0
  // with EACCES. Inside a container loopback is unreachable from every other
  // container and from the published port, so the compose stacks set 0.0.0.0.
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
