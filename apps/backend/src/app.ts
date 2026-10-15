// Builds the Fastify app without listening, so tests can drive it with inject().
import Fastify, { type FastifyReply, type FastifyServerOptions } from 'fastify';
import { type FastifyPluginAsyncZod, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { KeyManager, RedisClient } from 'ioredis-toolkit';
import type { Config } from './config/index.ts';
import { ModeUnavailableError, registerErrorHandling } from './http/errors.ts';
import { eventRoutes } from './http/events.ts';
import { statusRoutes } from './http/status.ts';
import { createEventLog, type NewEntry } from './redis/event-log.ts';
import { createModeChecks } from './redis/mode-checks.ts';
import { closeModeClients, connectionConfig, createModeClients, sessionKeyManager } from './redis/mode-clients.ts';
import { startTrace, type TraceRecording } from './redis/redis-trace.ts';
import { createSessionMetrics, type SessionMetricsSink } from './redis/session-metrics.ts';
import { createStatusMonitor } from './redis/status-monitor.ts';
import { createTemporaryClients, type TemporaryClients } from './redis/temporary-clients.ts';
import { cacheModule } from './modules/cache/plugin.ts';
import { clientModule } from './modules/client/plugin.ts';
import { lockModule } from './modules/lock/plugin.ts';
import { pubsubModule } from './modules/pubsub/plugin.ts';
import { rateLimitModule } from './modules/rate-limit/plugin.ts';
import { sessionModule } from './modules/session/plugin.ts';
import { streamsModule } from './modules/streams/plugin.ts';

/**
 * A feature module: registered once per mode under `/api/<mode>/<name>`, given that mode's client (and a factory for
 * temporary clients on the same connection) and its event log, and never told which mode it is on. Its POST routes
 * return the package's result as is; the mode scope sends it as `{ result, redis }`. Its GET routes are live views (a
 * lease, an SSE stream): untraced, sent as they are.
 */
export type FeatureModule = FastifyPluginAsyncZod<{
  client: RedisClient;
  temporaryClients: TemporaryClients;
  events: ModeEvents;
  /** The mode client's session metrics sink. */
  sessionMetrics: SessionMetricsSink;
  /** The key manager the mode client encrypts sessions with, for reading records beside the package. */
  sessionKeys: KeyManager;
}>;

/** One mode's event log, for what a feature module notices in the background. */
export interface ModeEvents {
  append(entry: NewEntry): void;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The Redis trace of a feature module request, from its handler on. */
    redisTrace: TraceRecording | null;
  }
}

/** The feature modules by name, which is also their path segment. */
export const FEATURE_MODULES: Record<string, FeatureModule> = {
  client: clientModule,
  session: sessionModule,
  cache: cacheModule,
  lock: lockModule,
  'rate-limit': rateLimitModule,
  pubsub: pubsubModule,
  streams: streamsModule,
};

export interface AppOptions {
  config: Config;
  logger?: FastifyServerOptions['logger'];
  modules?: Record<string, FeatureModule>;
}

export async function buildApp({ config, logger = false, modules = FEATURE_MODULES }: AppOptions) {
  const app = Fastify({ logger });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  app.decorateRequest('redisTrace', null);

  const eventLog = createEventLog();
  const sessionMetrics = new Map(config.SHOWCASE_MODES.map((mode) => [mode, createSessionMetrics()]));
  const sessionKeys = sessionKeyManager(config);
  const clients = createModeClients(config, {
    sessionMetrics: (mode) => sessionMetrics.get(mode)!,
    onError(mode, error, { source, channel }) {
      app.log.warn({ mode, source, channel, err: error }, 'mode client error');
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: unknown } | null)?.code;
      eventLog.append(mode, { kind: 'error', source, ...(channel && { channel }), ...(typeof code === 'string' && { code }), message });
    },
  });
  const modeChecks = createModeChecks(clients, config);
  const monitor = createStatusMonitor({ checks: modeChecks.checks, eventLog });

  // The first check runs before the app answers, so /api/status and the 503 guard start from real results.
  app.addHook('onReady', async () => {
    await monitor.refresh();
    monitor.start();
  });
  app.addHook('onClose', async () => {
    monitor.stop();
    modeChecks.close();
    await closeModeClients(clients);
  });

  await app.register(statusRoutes, { monitor });
  await app.register(eventRoutes, { eventLog, monitor });

  for (const [mode, client] of clients) {
    const temporaryClients = createTemporaryClients(connectionConfig(mode, config), (error, { source, channel }) =>
      app.log.warn({ mode, source, channel, err: error }, 'temporary client error'),
    );
    await app.register(
      async (scope) => {
        scope.addHook('onRequest', async (request) => {
          request.mode = mode;
          if (!monitor.isAvailable(mode)) throw new ModeUnavailableError(mode);
        });
        // Every command an operation (a POST) sends is recorded; the response carries that trace as `redis`, beside the
        // package's result (`{ result, redis }`, plus `setCookie` when it sets one) or the error (`{ error, redis }`).
        scope.addHook('preHandler', (request, _reply, done) => {
          if (request.method !== 'POST') return done();
          request.redisTrace = startTrace();
          request.redisTrace.run(done);
        });
        scope.addHook('onSend', async (request, reply, payload) => {
          if (!request.redisTrace || typeof payload !== 'string') return payload;
          const redis = await request.redisTrace.finish(client, { cluster: mode === 'cluster' });
          if (reply.statusCode >= 300) return JSON.stringify({ ...JSON.parse(payload), redis });
          // Fastify sends a string result (getValue on a cached string) as is, as text/plain: it is the result itself.
          const result = isJson(reply) ? JSON.parse(payload) : payload;
          reply.type('application/json; charset=utf-8');
          // A cookie the response sets (a session login) is echoed as is, since the page can't read an HttpOnly one.
          const setCookie = reply.getHeader('set-cookie');
          return JSON.stringify({ result, redis, ...(typeof setCookie === 'string' && { setCookie }) });
        });
        const events: ModeEvents = { append: (entry) => eventLog.append(mode, entry) };
        for (const [name, module] of Object.entries(modules)) {
          await scope.register(module, {
            client, temporaryClients, events, sessionMetrics: sessionMetrics.get(mode)!, sessionKeys, prefix: `/${name}`,
          });
        }
      },
      { prefix: `/api/${mode}` },
    );
  }
  return app;
}

const isJson = (reply: FastifyReply) => String(reply.getHeader('content-type') ?? '').startsWith('application/json');
