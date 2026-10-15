// The session feature module: one POST per session operation, each returning exactly what the package returned. A login
// sets this mode's session cookie with the package's own cookie helper, and an operation given no token presents that
// cookie, as a real request would. Registered once per mode under /api/<mode>/session; it only ever sees that mode's
// client.
import {
  SessionCreateRequestSchema, SessionListRequestSchema, SessionRecordsQuerySchema, SessionRevokeAllRequestSchema,
  SessionSecurityVersionRequestSchema, SessionStoredQuerySchema, SessionTokenRequestSchema, SessionUpdateRequestSchema,
  type SessionCookie, type SessionStored,
} from '@showcase/contracts';
import type { RedisClient } from 'ioredis-toolkit';
import type { FeatureModule } from '../../app.ts';
import { readRecords, userKeys } from './records.ts';

/** GET and TTL in one round trip, on whichever node owns the key. A missing key's GET comes back as null. */
const STORED = "return { redis.call('GET', KEYS[1]), redis.call('TTL', KEYS[1]) }";

async function readStored(client: RedisClient, key: string): Promise<SessionStored> {
  const [value, ttl] = (await client.eval(STORED, 1, key)) as [string | null, number];
  return { key, value: value ?? null, ttl: value === null || ttl < 0 ? null : ttl };
}

/** One cookie's value from a `Cookie` header, or null when the header doesn't carry it. */
function readCookie(header: string | undefined, name: string): string | null {
  for (const pair of header?.split(';') ?? []) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) return decodeURIComponent(pair.slice(at + 1).trim());
  }
  return null;
}

export const sessionModule: FeatureModule = async (app, { client, sessionMetrics, sessionKeys }) => {
  const { sessions } = client;
  const cookieName = client.config.sessions.cookie.name;
  /** The credential an operation presents: the one in the body, else this mode's cookie, else none (''). */
  const presented = ({ body, headers }: { body: { token?: string }; headers: { cookie?: string } }) =>
    body.token ?? readCookie(headers.cookie, cookieName) ?? '';

  // A fake login: any user id, no password. The IP address and user agent are the request's, as in a real login.
  app.post('/create', { schema: { body: SessionCreateRequestSchema } }, async ({ body, ip, headers }, reply) => {
    const created = await sessions.create({ ...body, ipAddress: ip, userAgent: headers['user-agent'] });
    reply.header('set-cookie', await sessions.cookie(created.token, created.session));
    return created;
  });
  // The live view of what Redis stores for a session: native GET + TTL, not a package call, so it is not traced. The
  // records are encrypted, so this is the ciphertext beside the session the package decrypts.
  app.get('/stored', { schema: { querystring: SessionStoredQuerySchema } }, ({ query }) =>
    readStored(client, userKeys(client.config.sessions.namespace, query.userId).record(query.id)),
  );
  // The live table: every record Redis holds for the user, tombstones included (see records.ts). Not traced either.
  app.get('/records', { schema: { querystring: SessionRecordsQuerySchema } }, ({ query }) =>
    readRecords(client, sessionKeys, query.userId),
  );
  // The cookie this request arrived with: HttpOnly, so the page asks the backend what the browser holds.
  app.get('/cookie', ({ headers }): SessionCookie => ({
    name: cookieName,
    value: readCookie(headers.cookie, cookieName),
  }));
  // What the package reported to this mode's metrics sink, live.
  app.get('/metrics', () => sessionMetrics.snapshot());
  app.post('/validate', { schema: { body: SessionTokenRequestSchema } }, (request) =>
    sessions.validate(presented(request)),
  );
  app.post('/get', { schema: { body: SessionTokenRequestSchema } }, (request) => sessions.get(presented(request)));
  // touch() returns nothing, and whether it wrote shows only in the trace; null stands for its undefined.
  app.post('/touch', { schema: { body: SessionTokenRequestSchema } }, async (request) => {
    await sessions.touch(presented(request));
    return null;
  });
  app.post('/update', { schema: { body: SessionUpdateRequestSchema } }, (request) =>
    sessions.update(presented(request), { metadata: request.body.metadata }, request.body.expectedVersion),
  );
  // An operation given no token presented this browser's cookie, so its response changes the cookie too: a rotation's
  // successor replaces it, as an app rotating on a privilege change would, and a logout clears it. A token from the
  // body (a stale one, another device's wallet entry) is not this browser's cookie, which stays.
  app.post('/rotate', { schema: { body: SessionTokenRequestSchema } }, async (request, reply) => {
    const rotated = await sessions.rotate(presented(request));
    if (request.body.token === undefined) {
      reply.header('set-cookie', await sessions.cookie(rotated.token, rotated.session));
    }
    return rotated;
  });
  // Logouts: revoke leaves a tombstone, destroy deletes outright. Both return nothing: null stands for their undefined.
  for (const op of ['revoke', 'destroy'] as const) {
    app.post(`/${op}`, { schema: { body: SessionTokenRequestSchema } }, async (request, reply) => {
      await sessions[op](presented(request));
      if (request.body.token === undefined) reply.header('set-cookie', sessions.deletionCookie());
      return null;
    });
  }
  app.post('/setSecurityVersion', { schema: { body: SessionSecurityVersionRequestSchema } }, async ({ body }) => {
    await sessions.setSecurityVersion(body.userId, body.version);
    return null;
  });
  app.post('/revokeAll', { schema: { body: SessionRevokeAllRequestSchema } }, ({ body }) =>
    sessions.revokeAll(body.userId, body.limit),
  );
  app.post('/list', { schema: { body: SessionListRequestSchema } }, ({ body }) =>
    sessions.list(body.userId, body.offset, body.limit),
  );

  // Reset section: a showcase convenience, not a session call. Deletes everything under the session namespace on this
  // mode; the cookie stays, and now answers not_found.
  app.post('/reset-section', () => client.deletePatternClusterAware(`${client.config.sessions.namespace}:*`));
};
