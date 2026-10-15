// The live table of a user's sessions: every record Redis holds for them, tombstones included, which list() can't show
// (it leaves out anything consumed, revoked or expired). Read natively beside the package: a SCAN for the user's record
// keys, then one script over the user's slot that reads them, the user's session set, their security version and Redis
// TIME at one instant. The records are decrypted with the showcase's own key manager, the one the mode client encrypts
// with, as the package's serializer would (its serializer isn't public).
import { createDecipheriv, createHash } from 'node:crypto';
import {
  SessionRecordSchema, type SessionInvalidReason, type SessionRecord, type SessionRecords,
} from '@showcase/contracts';
import type { KeyManager, RedisClient } from 'ioredis-toolkit';

/**
 * KEYS[1] the user's session set, KEYS[2] their security version, KEYS[3..] their record keys (all in the user's slot).
 * Returns { server seconds, security version or false, the set's members, each record's value or false, each one's
 * PTTL }.
 */
const READ = `
local values, ttls = {}, {}
for i = 3, #KEYS do
  values[#values + 1] = redis.call('GET', KEYS[i])
  ttls[#ttls + 1] = redis.call('PTTL', KEYS[i])
end
return { redis.call('TIME')[1], redis.call('GET', KEYS[2]), redis.call('ZRANGE', KEYS[1], 0, -1), values, ttls }`;

/**
 * The package's keys for a user, built as it builds them (its key strategy isn't public): the namespace, the kind and
 * the user's hash tag `{sha256(userId)}`, so they all share one slot. A record's key ends with its session id, the
 * hash of its token.
 */
export function userKeys(namespace: string, userId: string) {
  const tag = `{${createHash('sha256').update(userId, 'utf8').digest('hex')}}`;
  return {
    record: (id: string) => `${namespace}:session:${tag}:${id}`,
    records: `${namespace}:session:${tag}:*`,
    sessionSet: `${namespace}:user-sessions:${tag}`,
    securityVersion: `${namespace}:security-version:${tag}`,
  };
}

/**
 * A stored value as a record: the package's envelope, AES-256-GCM under its key version when encrypted. Null when it
 * can't be read.
 */
export function decodeRecord(value: string, keys: KeyManager): SessionRecord | null {
  try {
    type Envelope = { enc?: number; keyVersion?: string; iv?: string; tag?: string; data: string };
    const envelope = JSON.parse(value) as Envelope;
    let payload = envelope.data;
    if (envelope.enc === 1) {
      const key = keys.get(envelope.keyVersion ?? '');
      if (!key) return null;
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv ?? '', 'base64url'));
      decipher.setAuthTag(Buffer.from(envelope.tag ?? '', 'base64url'));
      payload = Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
    }
    return SessionRecordSchema.parse(JSON.parse(payload));
  } catch {
    return null;
  }
}

/**
 * What validate() would answer for a record's credential, in the order it checks: null when it would be valid. The mode
 * clients enable security versions, so a user with none stored can't authenticate either.
 */
function reasonFor(
  session: SessionRecord, now: number, inSessionSet: boolean, securityVersion: number | null,
): SessionInvalidReason | null {
  if (session.status !== 'active') return session.status;
  if (session.expiresAt <= now) return 'expired';
  if (session.absoluteExpiresAt !== null && session.absoluteExpiresAt <= now) return 'absolute_timeout';
  if (session.idleExpiresAt !== null && session.idleExpiresAt <= now) return 'idle_timeout';
  if (!inSessionSet || securityVersion === null || session.securityVersion !== securityVersion) return 'invalid';
  return null;
}

export async function readRecords(
  client: RedisClient, sessionKeys: KeyManager, userId: string,
): Promise<SessionRecords> {
  const redisKeys = userKeys(client.config.sessions.namespace, userId);
  const recordKeys = await client.scanCluster(redisKeys.records);
  const [time, version, members, values, ttls] = (await client.eval(
    READ, 2 + recordKeys.length, redisKeys.sessionSet, redisKeys.securityVersion, ...recordKeys,
  )) as [string, string | null, string[], (string | null)[], number[]];
  const serverTime = Number(time);
  const securityVersion = version === null ? null : Number(version);
  const inSet = new Set(members);
  const sessions = recordKeys.flatMap((key, i) => {
    const value = values[i];
    if (value === null) return []; // deleted between the SCAN and the read
    const session = decodeRecord(value, sessionKeys);
    const inSessionSet = inSet.has(key.slice(key.lastIndexOf(':') + 1));
    return [{
      key,
      ttl: ttls[i] < 0 ? null : Math.ceil(ttls[i] / 1000),
      inSessionSet,
      session,
      reason: session ? reasonFor(session, serverTime, inSessionSet, securityVersion) : 'invalid' as const,
    }];
  });
  sessions.sort((a, b) => (a.session?.createdAt ?? 0) - (b.session?.createdAt ?? 0));
  return { userId, serverTime, securityVersion, sessions };
}
