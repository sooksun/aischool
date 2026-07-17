// Defense-in-depth response headers (SEIP-OPS-004 / SEC-OWASP A05).
// Edge nginx is the primary place for HSTS and browser policy; this plugin
// ensures API responses still carry baseline headers when reached directly
// (localhost bring-up, misrouted traffic).
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export const securityHeadersPlugin: FastifyPluginAsync = fp(async (app) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    // Never override if already set (tests / route-specific).
    if (!reply.getHeader('x-content-type-options')) {
      reply.header('x-content-type-options', 'nosniff');
    }
    if (!reply.getHeader('x-frame-options')) {
      reply.header('x-frame-options', 'DENY');
    }
    if (!reply.getHeader('referrer-policy')) {
      reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    }
    if (!reply.getHeader('cache-control')) {
      // Auth tokens must not be cached by shared proxies.
      reply.header('cache-control', 'no-store');
    }
    if (!reply.getHeader('x-permitted-cross-domain-policies')) {
      reply.header('x-permitted-cross-domain-policies', 'none');
    }
    return payload;
  });
});
