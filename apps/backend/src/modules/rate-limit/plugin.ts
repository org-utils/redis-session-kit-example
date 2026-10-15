// The rate-limit feature module: one POST per public rate-limiter method, each returning exactly what the package
// returned. Registered once per mode under /api/<mode>/rate-limit; it only ever sees that mode's client.
import { RateLimitConsumeRequestSchema, RateLimitSubjectRequestSchema } from '@showcase/contracts';
import type { FeatureModule } from '../../app.ts';

export const rateLimitModule: FeatureModule = async (app, { client }) => {
  const { rateLimiter } = client;

  app.post('/consume', { schema: { body: RateLimitConsumeRequestSchema } }, ({ body }) =>
    rateLimiter.consume(body.subject, body.cost),
  );
  app.post('/check', { schema: { body: RateLimitSubjectRequestSchema } }, ({ body }) => rateLimiter.check(body.subject));
  app.post('/reset', { schema: { body: RateLimitSubjectRequestSchema } }, ({ body }) => rateLimiter.reset(body.subject));

  // Reset section: a showcase convenience, not a rate-limit call. Deletes everything under the namespace on this mode.
  app.post('/reset-section', () => client.deletePatternClusterAware(`${client.config.rateLimit.namespace}:*`));
};
