// Builds the Fastify app without listening, so tests can drive it with inject().
import Fastify, { type FastifyServerOptions } from 'fastify';
import { type FastifyPluginAsyncZod, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { RedisClient } from 'ioredis-toolkit';
import type { Config } from './config/index.ts';
import { ModeUnavailableError, registerErrorHandling } from './http/errors.ts';
import { eventRoutes } from './http/events.ts';
import { statusRoutes } from './http/status.ts';
import { createEventLog } from './redis/event-log.ts';
import { createModeChecks } from './redis/mode-checks.ts';
import { closeModeClients, createModeClients } from './redis/mode-clients.ts';
import { createStatusMonitor } from './redis/status-monitor.ts';

/**
 * A feature module: registered once per mode under `/api/<mode>`, given that mode's client, and never told which mode
 * it is on.
 */
export type FeatureModule = FastifyPluginAsyncZod<{ client: RedisClient }>;

export interface AppOptions {
  config: Config;
  logger?: FastifyServerOptions['logger'];
  modules?: FeatureModule[];
}

export async function buildApp({ config, logger = false, modules = [] }: AppOptions) {
  const app = Fastify({ logger });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const eventLog = createEventLog();
  const clients = createModeClients(config, {
    onError(mode, error, { source, channel }) {
      app.log.warn({ mode, source, channel, err: error }, 'mode client error');
      const message = error instanceof Error ? error.message : String(error);
      eventLog.append(mode, { kind: 'error', source, ...(channel && { channel }), message });
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
    await app.register(
      async (scope) => {
        scope.addHook('onRequest', async (request) => {
          request.mode = mode;
          if (!monitor.isAvailable(mode)) throw new ModeUnavailableError(mode);
        });
        for (const module of modules) await scope.register(module, { client });
      },
      { prefix: `/api/${mode}` },
    );
  }
  return app;
}
