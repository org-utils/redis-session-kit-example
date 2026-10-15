// Mock sessions: an in-memory stand-in for ioredis-toolkit sessions, following docs/STATE-MACHINE.md at v1.1.2
// closely enough to demo the lifecycle. One store per connection mode. Not the package; not accurate to the byte.
'use client';

import { useCallback, useRef, useState } from 'react';
import type { KeyTouched, Mode, RunResult } from './mock-backend';
import { nodeOf, slotOf } from './mock-backend';

export type Status = 'active' | 'consumed' | 'revoked';
export type Reason = 'not_found' | 'expired' | 'idle_timeout' | 'absolute_timeout' | 'revoked' | 'consumed' | 'invalid';

/** Demo config: realistic defaults; examples pass short per-session overrides to make expiry watchable. */
export const DEMO_CONFIG = { ttl: 3600, idleTimeout: 900, absoluteTimeout: 3600, touchInterval: 10, tombstoneCap: 300 };

export interface Rec {
  jti: string; token: string; userId: string; deviceId: string; status: Status; version: number; securityVersion: number;
  createdAt: number; expiresAt: number; absoluteAt: number; idleTimeout: number | null; idleExpiresAt: number | null;
  lastTouchAt: number; metadata: Record<string, unknown>; predecessorJti: string | null; successorJti: string | null;
  tombstoneUntil: number | null;
}

export interface WalletToken { token: string; jti: string; label: string; issuedAt: number }
export interface Transition { from: Status | 'none'; to: Status | 'deleted'; jti: string }

interface Store { recs: Map<string, Rec>; tokens: Map<string, string>; sv: Map<string, number>; sets: Map<string, Set<string>>; gone: Rec[] }
const newStore = (): Store => ({ recs: new Map(), tokens: new Map(), sv: new Map(), sets: new Map(), gone: [] });

const rnd = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const hash = (s: string) => { let h = 0x811c9dc5; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };
const now = () => Math.floor(Date.now() / 1000);

export class SessionError extends Error {
  constructor(public code: string, public errName: string, message: string, public http: number) { super(message); }
}
const reasonError = (r: Reason) => {
  switch (r) {
    case 'consumed': return new SessionError('SESSION_REPLAY', 'SessionReplayError', 'credential belongs to a consumed session', 409);
    case 'revoked': return new SessionError('SESSION_REVOKED', 'SessionRevokedError', 'session was revoked', 401);
    case 'not_found': return new SessionError('SESSION_NOT_FOUND', 'SessionNotFoundError', 'no such session', 404);
    case 'invalid': return new SessionError('SESSION_INVALID', 'SessionInvalidError', 'session is invalid (security version or set membership)', 401);
    default: return new SessionError('SESSION_EXPIRED', 'SessionExpiredError', `session ${r.replace('_', ' ')}`, 401);
  }
};

export class SessionSim {
  constructor(private s: Store, private mode: Mode) {}

  private u = (userId: string) => hash(userId);
  keysFor(r: Rec): KeyTouched[] {
    const k = (key: string, type: string, ttl: number | null): KeyTouched =>
      this.mode === 'cluster' ? { key, type, ttl, slot: slotOf(key), node: nodeOf(slotOf(key)) } : { key, type, ttl };
    const ttl = Math.max(0, (r.tombstoneUntil ?? r.expiresAt) - now());
    return [
      k(`showcase:session:session:{${this.u(r.userId)}}:${hash(r.token)}`, 'string', ttl),
      k(`showcase:session:user-sessions:{${this.u(r.userId)}}`, 'zset', Math.max(0, r.expiresAt - now())),
      k(`showcase:session:security-version:{${this.u(r.userId)}}`, 'string', Math.max(0, r.expiresAt - now())),
      k(`showcase:session:token-index:${hash(r.token)}`, 'string', ttl),
    ];
  }

  private sweep() {
    const t = now();
    for (const r of [...this.s.recs.values()]) {
      if ((r.tombstoneUntil !== null && t >= r.tombstoneUntil) || t >= r.expiresAt + DEMO_CONFIG.tombstoneCap) this.erase(r);
    }
  }
  private erase(r: Rec) {
    this.s.recs.delete(r.jti); this.s.tokens.delete(r.token); this.s.sets.get(r.userId)?.delete(r.jti);
    this.s.gone.unshift({ ...r }); this.s.gone.length = Math.min(this.s.gone.length, 50);
  }
  private find(token: string) { this.sweep(); const jti = this.s.tokens.get(token); return jti ? this.s.recs.get(jti) : undefined; }

  check(token: string): { valid: true; rec: Rec } | { valid: false; reason: Reason; rec?: Rec } {
    const r = this.find(token);
    if (!r) return { valid: false, reason: 'not_found' };
    if (r.status === 'consumed') return { valid: false, reason: 'consumed', rec: r };
    if (r.status === 'revoked') return { valid: false, reason: 'revoked', rec: r };
    const t = now();
    if (t >= r.absoluteAt) return { valid: false, reason: 'absolute_timeout', rec: r };
    if (t >= r.expiresAt) return { valid: false, reason: 'expired', rec: r };
    if (r.idleExpiresAt !== null && t >= r.idleExpiresAt) return { valid: false, reason: 'idle_timeout', rec: r };
    if (!this.s.sets.get(r.userId)?.has(r.jti)) return { valid: false, reason: 'invalid', rec: r };
    if ((this.s.sv.get(r.userId) ?? -1) !== r.securityVersion) return { valid: false, reason: 'invalid', rec: r };
    return { valid: true, rec: r };
  }
  private active(token: string) { const c = this.check(token); if (!c.valid) throw reasonError(c.reason); return c.rec; }

  create(input: { userId: string; deviceId: string; securityVersion: number; metadata: Record<string, unknown>; ttl?: number; idleTimeout?: number; absoluteTimeout?: number }) {
    if (JSON.stringify(input.metadata).length > 8192) throw new SessionError('SESSION_LIMIT', 'SessionLimitError', 'metadata exceeds maxMetadataBytes (8192)', 413);
    const t = now();
    const absolute = input.absoluteTimeout ?? DEMO_CONFIG.absoluteTimeout;
    const ttl = Math.min(input.ttl ?? DEMO_CONFIG.ttl, absolute);
    const idle = input.idleTimeout ?? DEMO_CONFIG.idleTimeout;
    if (!this.s.sv.has(input.userId)) this.s.sv.set(input.userId, input.securityVersion);
    const jti = `j_${rnd(4)}`;
    const rec: Rec = { jti, token: `${jti}.${rnd(16)}`, userId: input.userId, deviceId: input.deviceId, status: 'active', version: 1,
      securityVersion: input.securityVersion, createdAt: t, expiresAt: t + ttl, absoluteAt: t + absolute, idleTimeout: idle,
      idleExpiresAt: t + idle, lastTouchAt: t, metadata: input.metadata, predecessorJti: null, successorJti: null, tombstoneUntil: null };
    this.s.recs.set(jti, rec); this.s.tokens.set(rec.token, jti);
    if (!this.s.sets.has(input.userId)) this.s.sets.set(input.userId, new Set());
    this.s.sets.get(input.userId)!.add(jti);
    return rec;
  }
  touch(token: string) {
    const r = this.active(token); const t = now();
    if (t - r.lastTouchAt < DEMO_CONFIG.touchInterval) return { touched: false, reason: 'throttled (touchInterval)', rec: r };
    r.lastTouchAt = t; if (r.idleTimeout) r.idleExpiresAt = Math.min(t + r.idleTimeout, r.expiresAt);
    return { touched: true, rec: r };
  }
  update(token: string, metadata: Record<string, unknown>, expectedVersion: number | null) {
    const r = this.active(token);
    if (expectedVersion !== null && expectedVersion !== r.version)
      throw new SessionError('SESSION_CONFLICT', 'SessionConflictError', `expected version ${expectedVersion}, stored ${r.version}`, 409);
    r.metadata = { ...r.metadata, ...metadata }; r.version++; return r;
  }
  rotate(token: string) {
    const r = this.active(token); const t = now();
    r.status = 'consumed'; r.version++; r.tombstoneUntil = Math.min(r.expiresAt, t + DEMO_CONFIG.tombstoneCap);
    this.s.sets.get(r.userId)?.delete(r.jti);
    const succ = this.create({ userId: r.userId, deviceId: r.deviceId, securityVersion: r.securityVersion, metadata: r.metadata,
      ttl: r.expiresAt - t, idleTimeout: r.idleTimeout ?? undefined, absoluteTimeout: r.absoluteAt - t });
    succ.predecessorJti = r.jti; r.successorJti = succ.jti;
    return { rec: succ, predecessor: r };
  }
  /** Follows a consumed record's chain to its end and revokes that one if active (ADR-0004). */
  revoke(token: string): { revoked: Rec | null; via: Rec[] } {
    let r = this.find(token); const via: Rec[] = [];
    if (!r) return { revoked: null, via };
    while (r && r.status === 'consumed' && r.successorJti) { via.push(r); r = this.s.recs.get(r.successorJti); }
    if (!r || r.status !== 'active') return { revoked: null, via };
    r.status = 'revoked'; r.version++; r.tombstoneUntil = Math.min(r.expiresAt, now() + DEMO_CONFIG.tombstoneCap);
    this.s.sets.get(r.userId)?.delete(r.jti);
    return { revoked: r, via };
  }
  destroy(token: string) { const r = this.find(token); if (r) this.erase(r); return r ?? null; }
  setSecurityVersion(userId: string, v: number) {
    if (!Number.isInteger(v) || v < 0) throw new SessionError('SESSION_INVALID', 'SessionInvalidError', 'security version must be a whole number ≥ 0', 400);
    this.s.sv.set(userId, v);
  }
  securityVersion(userId: string) { return this.s.sv.get(userId) ?? null; }
  revokeAll(userId: string, limit: number) {
    const ids = [...(this.s.sets.get(userId) ?? [])]; const batch = ids.slice(0, Math.min(limit, 200));
    for (const id of batch) { const r = this.s.recs.get(id); if (r) this.erase(r); }
    return { affected: batch.length, remaining: ids.length - batch.length };
  }
  list(userId: string) { this.sweep(); const t = now(); return [...(this.s.sets.get(userId) ?? [])].map((id) => this.s.recs.get(id)!).filter((r) => r && t < r.expiresAt && (r.idleExpiresAt === null || t < r.idleExpiresAt) && t < r.absoluteAt); }
  /** Everything this mode's Redis holds for a user, tombstones included, plus recently gone records: for the board view. */
  all(userId?: string) { this.sweep(); const keep = (r: Rec) => !userId || r.userId === userId; return { live: [...this.s.recs.values()].filter(keep), gone: this.s.gone.filter(keep) }; }
  users() { return [...new Set([...this.s.recs.values()].map((r) => r.userId))]; }
}

/** Public view of a record, shaped like the package's session object. */
export const view = (r: Rec) => ({
  id: r.jti, userId: r.userId, deviceId: r.deviceId, status: r.status, version: r.version, securityVersion: r.securityVersion,
  createdAt: r.createdAt, expiresAt: r.expiresAt, idleExpiresAt: r.idleExpiresAt, metadata: r.metadata,
  ...(r.predecessorJti ? { predecessorId: r.predecessorJti } : {}), ...(r.successorJti ? { successorId: r.successorJti } : {}),
});

export const cookieFor = (mode: Mode, token: string | null) => token
  ? `showcase_session_${mode}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEMO_CONFIG.ttl}`
  : `showcase_session_${mode}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

let runId = 100000;

/** Per-mode stores plus a per-mode "browser": the current cookie and every token this browser was ever given. */
export function useSessionLab(mode: Mode) {
  const stores = useRef<Record<Mode, Store>>({ standalone: newStore(), sentinel: newStore(), cluster: newStore() });
  const [cookies, setCookies] = useState<Record<Mode, string | null>>({ standalone: null, sentinel: null, cluster: null });
  const [wallets, setWallets] = useState<Record<Mode, WalletToken[]>>({ standalone: [], sentinel: [], cluster: [] });
  const [lastTransition, setLastTransition] = useState<Transition | null>(null);
  const [previousTokens, setPrevious] = useState<Record<Mode, string | null>>({ standalone: null, sentinel: null, cluster: null });
  const previous = previousTokens[mode];
  const [, force] = useState(0);
  const sim = new SessionSim(stores.current[mode], mode);
  const cookie = cookies[mode];
  const wallet = wallets[mode];

  const remember = (rec: Rec, label: string) =>
    setWallets((w) => ({ ...w, [mode]: [{ token: rec.token, jti: rec.jti, label, issuedAt: Date.now() }, ...w[mode]] }));
  const resolve = (t: string) => (t === '$cookie' || t === '' ? cookie ?? '' : t === '$previous' ? previous ?? '' : t);

  /** Runs one session operation and returns a RunResult for the shell's result cards and Redis-state panel. */
  const run = useCallback((op: string, v: Record<string, unknown>): RunResult & { setCookie?: string } => {
    const started = performance.now();
    const base = { id: ++runId, at: new Date().toLocaleTimeString(), mode, module: 'session', op, input: Object.values(v).map(String).join(' · ') };
    const done = (body: unknown, rec: Rec | null, commands: string[], extra: { setCookie?: string; http?: number } = {}) => {
      force((n) => n + 1);
      return { ...base, latencyMs: +(performance.now() - started + 0.4).toFixed(2), httpStatus: extra.http ?? 200,
        body: extra.setCookie ? { ...(body as object), setCookie: extra.setCookie } : body, keys: rec ? sim.keysFor(rec) : [], commands, setCookie: extra.setCookie };
    };
    try {
      const token = resolve(String(v.token ?? '$cookie'));
      switch (op) {
        case 'create': {
          const n = (x: unknown) => (x === '' || x === undefined || x === null ? undefined : Number(x));
          const rec = sim.create({ userId: String(v.userId), deviceId: String(v.deviceId), securityVersion: Number(v.securityVersion ?? 1),
            metadata: JSON.parse(String(v.metadata || '{}')), ttl: n(v.ttl), idleTimeout: n(v.idleTimeout), absoluteTimeout: n(v.absoluteTimeout) });
          setCookies((c) => ({ ...c, [mode]: rec.token })); remember(rec, `${rec.userId} · ${rec.deviceId}`);
          setLastTransition({ from: 'none', to: 'active', jti: rec.jti });
          return done({ token: rec.token, session: view(rec) }, rec, ['EVALSHA create.lua 3 …', `SET token-index:${hash(rec.token)} …`], { setCookie: cookieFor(mode, rec.token) });
        }
        case 'validate': {
          const c = sim.check(token);
          return done(c.valid ? { valid: true, session: view(c.rec) } : { valid: false, reason: c.reason }, c.rec ?? null, ['GET token-index:…', 'EVALSHA validate.lua 3 …']);
        }
        case 'get': { const c = sim.check(token); if (!c.valid) throw reasonError(c.reason); return done(view(c.rec), c.rec, ['GET token-index:…', 'EVALSHA validate.lua 3 …']); }
        case 'touch': { const t = sim.touch(token); return done({ touched: t.touched, ...(t.reason ? { reason: t.reason } : {}), idleExpiresAt: t.rec.idleExpiresAt }, t.rec, t.touched ? ['EVALSHA cas.lua 1 …'] : ['(no write: within touchInterval)']); }
        case 'update': {
          const ev = v.expectedVersion === '' || v.expectedVersion === undefined ? null : Number(v.expectedVersion);
          const r = sim.update(token, JSON.parse(String(v.metadata || '{}')), ev);
          return done(view(r), r, ['EVALSHA cas.lua 1 …']);
        }
        case 'rotate': {
          const { rec, predecessor } = sim.rotate(token);
          setCookies((c) => ({ ...c, [mode]: rec.token })); setPrevious((p) => ({ ...p, [mode]: predecessor.token })); remember(rec, `rotated from ${predecessor.jti}`);
          setLastTransition({ from: 'active', to: 'consumed', jti: predecessor.jti });
          return done({ token: rec.token, session: view(rec), previousJti: predecessor.jti }, rec, ['EVALSHA consume.lua 1 …', 'ZREM user-sessions …', 'EVALSHA create.lua 3 …'], { setCookie: cookieFor(mode, rec.token) });
        }
        case 'revoke': {
          const { revoked, via } = sim.revoke(token);
          if (revoked) setLastTransition({ from: 'active', to: 'revoked', jti: revoked.jti });
          setCookies((c) => ({ ...c, [mode]: null }));
          return done({ revoked: revoked?.jti ?? null, followedChainThrough: via.map((r) => r.jti) }, revoked ?? via[0] ?? null,
            ['GET token-index:…', ...via.map(() => 'GET session (follow successor)'), 'EVALSHA revoke.lua 1 …', 'ZREM user-sessions …'], { setCookie: cookieFor(mode, null) });
        }
        case 'destroy': {
          const r = sim.destroy(token);
          if (r) setLastTransition({ from: r.status, to: 'deleted', jti: r.jti });
          setCookies((c) => ({ ...c, [mode]: null }));
          return done({ destroyed: r?.jti ?? null }, null, ['DEL session …', 'DEL token-index …', 'ZREM user-sessions …'], { setCookie: cookieFor(mode, null) });
        }
        case 'setSecurityVersion': {
          sim.setSecurityVersion(String(v.userId), Number(v.version));
          return done({ userId: v.userId, securityVersion: Number(v.version) }, null, [`SET security-version:{${hash(String(v.userId))}} ${v.version} EX …`]);
        }
        case 'revokeAll': {
          const res = sim.revokeAll(String(v.userId), Number(v.limit ?? 200));
          setCookies((c) => ({ ...c, [mode]: null }));
          return done(res, null, ['ZRANGE user-sessions …', 'DEL token-index … (cluster-aware)', 'pipeline: DEL session …, ZREM …']);
        }
        case 'list': return done(sim.list(String(v.userId)).map(view), null, ['ZRANGE user-sessions … ', 'MGET sessions (same slot)']);
        default: return done({ note: 'unknown op' }, null, []);
      }
    } catch (e) {
      if (e instanceof SessionError) return done({ error: { code: e.code, name: e.errName, message: e.message, mode } }, null, [], { http: e.http });
      return done({ error: { code: 'SESSION_INPUT', name: 'SessionInputError', message: String((e as Error).message), mode } }, null, [], { http: 400 });
    }
  }, [mode, cookie, wallet, previous]); // eslint-disable-line react-hooks/exhaustive-deps

  return { sim, run, cookie, wallet, previous, lastTransition, tick: () => force((n) => n + 1) };
}
