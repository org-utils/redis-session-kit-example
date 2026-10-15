// GET /api/status: the status monitor's latest result per mode, refreshed every 2 s in the background.
import { StatusResponseSchema } from '@showcase/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { StatusMonitor } from '../redis/status-monitor.ts';

export const statusRoutes: FastifyPluginAsyncZod<{ monitor: StatusMonitor }> = async (app, { monitor }) => {
  app.get('/api/status', { schema: { response: { 200: StatusResponseSchema } } }, () => ({ modes: monitor.snapshot() }));
};
