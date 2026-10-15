// The one error handler: every error becomes `{ error: { code, name, message, mode } }` with the agreed status code.
// Expected outcomes (a denied rate limit, a lock not acquired, an invalid session) are not errors: they return 200 with
// the package's own result and never reach this handler.
import type { ErrorBody, Mode } from '@showcase/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import { RedisToolkitError } from 'ioredis-toolkit';
import { UNHEALTHY_CHECKS_BEFORE_UNAVAILABLE } from '../redis/status-monitor.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The connection mode of an `/api/:mode/...` request, null elsewhere. */
    mode: Mode | null;
  }
}

export class ModeUnavailableError extends Error {
  readonly code = 'MODE_UNAVAILABLE';
  constructor(mode: Mode) {
    super(
      `${mode} is unavailable: unhealthy for ${UNHEALTHY_CHECKS_BEFORE_UNAVAILABLE} checks in a row, or never healthy since the backend started`,
    );
    this.name = 'ModeUnavailableError';
  }
}

/** A refusal of the showcase's own (not the package's), with its status and code: `409 DRILL_IN_PROGRESS`, … */
export class ShowcaseError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ShowcaseError';
    this.status = status;
    this.code = code;
  }
}

/** Status codes for the package's error codes. Anything not listed is a 500. */
function packageStatus(code: string): number {
  if (code.endsWith('_INPUT')) return 400;
  if (code === 'SESSION_NOT_FOUND') return 404;
  // A credential that can no longer authenticate (get(), touch(), update()…); SESSION_INVALID is also the package's
  // answer to malformed input, such as a ttl over absoluteTimeout, so it stays a 400.
  if (code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED' || code === 'SESSION_REPLAY') return 401;
  if (code === 'SESSION_INVALID') return 400;
  if (code === 'SESSION_CONFLICT' || code === 'LOCK_HELD') return 409;
  if (code.endsWith('_LIMIT')) return 413;
  return 500;
}

/** ioredis's ReplyError: Redis itself answered with an error (`CROSSSLOT …`, `NOGROUP …`, `MOVED …`). */
const isRedisReply = (error: Error) => error.name === 'ReplyError';

/**
 * ioredis refusing a cluster pipeline whose keys span slots, before sending anything. Not Redis's error, but the same
 * lesson as CROSSSLOT, so it answers alike: 502 with ioredis's own message.
 */
const isPipelineSlots = (error: Error) => error.message === 'All keys in the pipeline should belong to the same slots allocation group';

function toResponse(error: FastifyError | Error, mode: Mode | null): { status: number; body: ErrorBody } {
  const body = (code: string, name = error.name) => ({ error: { code, name, message: error.message, mode } });
  if (error instanceof ModeUnavailableError) return { status: 503, body: body(error.code) };
  if (error instanceof ShowcaseError) return { status: error.status, body: body(error.code) };
  // A package error names its class: every session error's `name` is SessionError, but its class says which
  // (SessionReplayError…).
  if (error instanceof RedisToolkitError) {
    return { status: packageStatus(error.code), body: body(error.code, error.constructor.name) };
  }
  if (isRedisReply(error)) return { status: 502, body: body(error.message.split(' ', 1)[0]) };
  if (isPipelineSlots(error)) return { status: 502, body: body('PIPELINE_SLOTS') };
  // Fastify's own client errors (validation, malformed body…) keep their status and code.
  const { statusCode, code } = error as FastifyError;
  if (statusCode && statusCode < 500) return { status: statusCode, body: body(code ?? 'BAD_REQUEST') };
  return { status: 500, body: body('INTERNAL') };
}

export function registerErrorHandling(app: FastifyInstance) {
  app.decorateRequest('mode', null);
  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toResponse(error instanceof Error ? error : new Error(String(error)), request.mode);
    if (status >= 500 && status !== 503) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorBody = {
      error: { code: 'NOT_FOUND', name: 'NotFoundError', message: `${request.method} ${request.url} not found`, mode: null },
    };
    return reply.code(404).send(body);
  });
}
