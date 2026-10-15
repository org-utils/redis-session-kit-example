// PROTOTYPE (throwaway): in-memory simulators and operation specs for the lock, rate-limit, pub/sub and streams live
// panes, following the catalogue settled in "Examples: settle the built-in examples…". Behaviour is simplified.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpSpec, Values } from './examples';
import type { Mode } from './mock-backend';

const rnd = (n = 6) => Math.random().toString(36).slice(2, 2 + n);
export function useNowMs(step = 100) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), step); return () => clearInterval(t); }, [step]);
  return n;
}

/* ───────────── lock: one lease key, two holder lanes ───────────── */
export type Lane = 'A' | 'B';
export interface LockResult { op: string; lane: Lane; body: unknown; call: string }
export function useLockSim() {
  const [lease, setLease] = useState<{ name: string; token: string; lane: Lane; expiresAt: number; using?: number } | null>(null);
  const [tokens, setTokens] = useState<Record<Lane, string[]>>({ A: [], B: [] });
  const [log, setLog] = useState<LockResult[]>([]);
  const leaseRef = useRef(lease); leaseRef.current = lease;
  const now = useNowMs();
  const live = lease && lease.expiresAt > now ? lease : null;
  const push = (r: LockResult) => { setLog((l) => [r, ...l].slice(0, 30)); return r; };
  const current = () => { const l = leaseRef.current; return l && l.expiresAt > Date.now() ? l : null; };

  const acquire = (lane: Lane, name: string, ttl: number): LockResult => {
    if (ttl > 300) return push({ op: 'acquire', lane, call: `lock.acquire('${name}', ${ttl})`, body: { error: { code: 'LOCK_LIMIT', message: `ttl ${ttl}s exceeds maxTtl 300s` } } });
    const token = `tk_${rnd()}`;
    setTokens((t) => ({ ...t, [lane]: [token, ...t[lane]].slice(0, 5) }));
    const held = current();
    const acquired = !held;
    if (acquired) setLease({ name, token, lane, expiresAt: Date.now() + ttl * 1000 });
    return push({ op: 'acquire', lane, call: `lock.acquire('${name}', ${ttl})`, body: { acquired, token } });
  };
  const extend = (lane: Lane, token: string, ttl: number): LockResult => {
    const held = current(), ok = !!held && held.token === token;
    if (ok) setLease({ ...held!, expiresAt: Date.now() + ttl * 1000 });
    return push({ op: 'extend', lane, call: `lock.extend(name, token, ${ttl})`, body: ok });
  };
  const release = (lane: Lane, token: string): LockResult => {
    const held = current(), ok = !!held && held.token === token;
    if (ok) setLease(null);
    return push({ op: 'release', lane, call: 'lock.release(name, token)', body: ok });
  };
  const using = (lane: Lane, name: string, workS: number, ttl: number): LockResult => {
    if (current()) return push({ op: 'using', lane, call: `lock.using('${name}', fn, ${ttl})`, body: { error: { code: 'LOCK_HELD', message: `lock ${name} is held` } } });
    const token = `tk_${rnd()}`;
    setLease({ name, token, lane, expiresAt: Date.now() + ttl * 1000, using: Date.now() + workS * 1000 });
    setTimeout(() => {
      const l = leaseRef.current;
      if (l && l.token === token && l.expiresAt > Date.now()) setLease(null);
      else push({ op: 'using', lane, call: 'onError(lock-release)', body: { onError: 'lock-release', message: `release of ${name} failed: lease expired mid-work` } });
    }, workS * 1000);
    return push({ op: 'using', lane, call: `lock.using('${name}', async () => work(${workS}s), ${ttl})`, body: { started: true, holdsFor: `${workS}s` } });
  };
  return { lease: live, now, tokens, log, acquire, extend, release, using };
}

export const LOCK_OPS: Record<string, OpSpec> = {
  acquire: {
    fields: [{ name: 'lane', label: 'holder', kind: 'select', options: ['A', 'B'] }, { name: 'name', label: 'name', kind: 'text' }, { name: 'ttl', label: 'ttl (seconds)', kind: 'number' }],
    examples: [
      { id: 'a', title: 'Nightly report job (A)', description: 'A 30 s lease from holder A.', values: { lane: 'A', name: 'report:nightly', ttl: 30 } },
      { id: 'b', title: '…then from B', description: 'Refused while A holds it, but B still gets a token.', values: { lane: 'B', name: 'report:nightly', ttl: 30 } },
      { id: 'short', title: 'Sub-second lease', description: 'TTLs may be fractional.', values: { lane: 'A', name: 'report:nightly', ttl: 0.5 } },
      { id: 'limit', title: 'Over maxTtl', description: '600 s → LOCK_LIMIT.', values: { lane: 'A', name: 'migration', ttl: 600 } },
    ],
    call: (v) => `await redis.lock.acquire('${v.name}', ${v.ttl})   // holder ${v.lane}`,
  },
  extend: {
    fields: [{ name: 'lane', label: 'holder', kind: 'select', options: ['A', 'B'] }, { name: 'token', label: 'token', kind: 'token' }, { name: 'ttl', label: 'ttl (seconds)', kind: 'number' }],
    examples: [
      { id: 'mine', title: 'Extend my lease', description: 'Resets the lease to ttl; it does not add to it.', values: { lane: 'A', token: '$A', ttl: 30 } },
      { id: 'refused', title: 'With the refused token', description: 'B\'s token from a refused acquire → false.', values: { lane: 'B', token: '$B', ttl: 30 } },
    ],
    call: (v) => `await redis.lock.extend('report:nightly', token, ${v.ttl})`,
  },
  release: {
    fields: [{ name: 'lane', label: 'holder', kind: 'select', options: ['A', 'B'] }, { name: 'token', label: 'token', kind: 'token' }],
    examples: [
      { id: 'mine', title: 'With my token', description: 'Compare-and-delete → true.', values: { lane: 'A', token: '$A' } },
      { id: 'theirs', title: 'With the other lane\'s token', description: '→ false; the lock survives.', values: { lane: 'B', token: '$B' } },
    ],
    call: () => `await redis.lock.release('report:nightly', token)`,
  },
  using: {
    fields: [{ name: 'lane', label: 'holder', kind: 'select', options: ['A', 'B'] }, { name: 'work', label: 'work (seconds)', kind: 'number' }, { name: 'ttl', label: 'ttl (seconds)', kind: 'number' }],
    examples: [
      { id: 'hold', title: 'Hold for 10 s', description: 'The other lane is refused meanwhile; a second using → LOCK_HELD.', values: { lane: 'A', work: 10, ttl: 30 } },
      { id: 'outlast', title: 'Work outlasts the lease', description: 'work 8 s, ttl 3: B can acquire mid-work; the release fails into the event log.', values: { lane: 'A', work: 8, ttl: 3 } },
    ],
    call: (v) => `await redis.lock.using('report:nightly', async () => work(${v.work}s), ${v.ttl})`,
  },
};

/* ───────────── rate limit: 10 per 20 s ───────────── */
export const RL = { limit: 10, windowS: 20 };
export interface RateResult { allowed: boolean; limit: number; remaining: number; resetAt: number; retryAfterSeconds: number; count: number }
export function useRateSim() {
  const [win, setWin] = useState<{ start: number; count: number } | null>(null);
  const [log, setLog] = useState<{ id: string; at: number; op: string; cost: number; r: RateResult | { error: { code: string } } | { reset: boolean } }[]>([]);
  const ref = useRef(win); ref.current = win;
  const now = useNowMs();
  const active = win && now < win.start + RL.windowS * 1000 ? win : null;
  const cur = () => { const w = ref.current; return w && Date.now() < w.start + RL.windowS * 1000 ? w : { start: Date.now(), count: 0 }; };
  const result = (w: { start: number; count: number }, allowed: boolean): RateResult => {
    const resetAt = Math.ceil((w.start + RL.windowS * 1000) / 1000);
    return { allowed, limit: RL.limit, remaining: Math.max(0, RL.limit - w.count), resetAt, retryAfterSeconds: allowed ? 0 : Math.max(1, resetAt - Math.floor(Date.now() / 1000)), count: w.count };
  };
  const push = (op: string, cost: number, r: RateResult | { error: { code: string } }) => { setLog((l) => [{ id: rnd(), at: Date.now(), op, cost, r }, ...l].slice(0, 60)); return r; };
  const consume = (subject: string, cost: number) => {
    if (!Number.isInteger(cost) || cost < 1 || subject.startsWith('}') || !subject) return push('consume', cost, { error: { code: 'RATE_LIMIT_INPUT' } });
    const w = cur(), next = w.count + cost, allowed = next <= RL.limit;
    const nw = allowed ? { ...w, count: next } : w; // simplified: a denied consume doesn't count
    ref.current = nw; setWin(nw);
    return push('consume', cost, result(nw, allowed));
  };
  const check = () => { const w = cur(); return push('check', 0, result(w, w.count < RL.limit)); };
  const reset = () => { const had = !!ref.current; ref.current = null; setWin(null); setLog((l) => [{ id: rnd(), at: Date.now(), op: 'reset', cost: 0, r: { reset: had } }, ...l]); return had; };
  const burst = (subject: string, n: number, gapMs = 100) => { for (let i = 0; i < n; i++) setTimeout(() => consume(subject, 1), i * gapMs); };
  return { win: active, now, log, consume, check, reset, burst };
}

export const RATE_OPS: Record<string, OpSpec> = {
  consume: {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }, { name: 'cost', label: 'cost', kind: 'number' }],
    examples: [
      { id: 'one', title: 'One request', description: 'remaining goes down by one.', values: { subject: 'user:42', cost: 1 } },
      { id: 'four', title: 'Expensive request', description: 'Costs 4 of the window at once.', values: { subject: 'user:42', cost: 4 } },
      { id: 'big', title: 'Bigger than the window', description: 'cost 11 > limit 10 → denied.', values: { subject: 'user:42', cost: 11 } },
      { id: 'bad', title: 'Invalid cost', description: '0 → RATE_LIMIT_INPUT.', values: { subject: 'user:42', cost: 0 } },
    ],
    call: (v) => `await redis.rateLimiter.consume('${v.subject}', ${v.cost})`,
  },
  check: {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }],
    examples: [
      { id: 'peek', title: 'Peek without consuming', description: 'Count unchanged.', values: { subject: 'user:42' } },
      { id: 'limit', title: 'At exactly the limit', description: 'After filling to 10: consume allowed the 10th, check says denied.', values: { subject: 'user:42' } },
    ],
    call: (v) => `await redis.rateLimiter.check('${v.subject}')`,
  },
  reset: {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }],
    examples: [{ id: 'reset', title: 'Reset a subject', description: '→ true; the next consume starts a fresh window.', values: { subject: 'user:42' } }],
    call: (v) => `await redis.rateLimiter.reset('${v.subject}')`,
  },
  burst: {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }, { name: 'n', label: 'calls', kind: 'number' }],
    examples: [{ id: 'fill', title: 'Fill the window', description: '15 × consume, 100 ms apart: 10 allowed, 5 denied.', values: { subject: 'user:42', n: 15 } }],
    call: (v) => `for (let i = 0; i < ${v.n}; i++) await redis.rateLimiter.consume('${v.subject}')   // sent by the showcase`,
  },
};

/* ───────────── pub/sub: one card per subscription ───────────── */
export interface Card { id: string; channel: string; messages: { seq: number; at: number; value: string }[] }
export interface Publish { id: string; at: number; channel: string; value: string; returned: number; delivered: number }
export function usePubSubSim(mode: Mode) {
  const [cards, setCards] = useState<Card[]>([]);
  const [pubs, setPubs] = useState<Publish[]>([]);
  const seq = useRef(0);
  const subscribe = (channel: string) => setCards((c) => [...c, { id: rnd(), channel, messages: [] }]);
  const unsubscribe = (id: string) => setCards((c) => c.filter((x) => x.id !== id));
  const publish = (channel: string, value: string) => {
    const listening = cards.filter((c) => c.channel === channel);
    // One SUBSCRIBE per channel on one subscriber connection: Redis counts 1, however many cards share it.
    const returned = listening.length ? (mode === 'cluster' ? (Math.random() < 0.5 ? 0 : 1) : 1) : 0;
    const s = ++seq.current;
    setCards((cs) => cs.map((c) => (c.channel === channel ? { ...c, messages: [{ seq: s, at: Date.now(), value }, ...c.messages].slice(0, 20) } : c)));
    const p = { id: rnd(), at: Date.now(), channel, value, returned, delivered: listening.length };
    setPubs((ps) => [p, ...ps].slice(0, 20));
    return p;
  };
  return { cards, pubs, subscribe, unsubscribe, publish };
}

export const PUBSUB_OPS: Record<string, OpSpec> = {
  subscribe: {
    fields: [{ name: 'channel', label: 'channel', kind: 'text' }],
    examples: [
      { id: 'listen', title: 'Listen to orders', description: 'Opens a card for orders.created.', values: { channel: 'orders.created' } },
      { id: 'second', title: 'A second listener', description: 'Same channel: both cards share one Redis SUBSCRIBE.', values: { channel: 'orders.created' } },
    ],
    call: (v) => `await redis.pubsub.subscribe('${v.channel}', (msg) => …)`,
  },
  publish: {
    fields: [{ name: 'channel', label: 'channel', kind: 'text' }, { name: 'message', label: 'message (JSON)', kind: 'json' }],
    examples: [
      { id: 'order', title: 'Order created', description: 'Returned count vs cards that received it; on cluster it can be 0.', values: { channel: 'orders.created', message: '{ "orderId": "42", "total": 19.99 }' } },
      { id: 'nobody', title: 'Nobody listening', description: '→ 0.', values: { channel: 'orders.cancelled', message: '{ "orderId": "7" }' } },
    ],
    call: (v) => `await redis.pubsub.publish('${v.channel}', ${String(v.message).replace(/\s+/g, ' ')})`,
  },
};

/* ───────────── streams: entries, groups, pending ───────────── */
export interface Entry { id: string; fields: Record<string, string> | Record<string, never> }
export interface Group { name: string; lastDelivered: number; pending: Record<string, string[]> }
export function useStreamSim() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const [read, setRead] = useState<Record<string, string[]>>({}); // ids each consumer was handed, for the ack dropdown
  const ms = useRef(Date.now());
  const add = (fields: Record<string, string>) => {
    if (!Object.keys(fields).length) return { error: { code: 'STREAMS_INPUT', message: 'fields must not be empty' } };
    const id = `${(ms.current += 137)}-0`;
    setEntries((e) => [...e, { id, fields }]);
    return id;
  };
  const createGroup = (name: string, start: '$' | '0') => {
    if (groups[name]) return true; // BUSYGROUP counts as success
    setGroups((g) => ({ ...g, [name]: { name, lastDelivered: start === '0' ? -1 : entries.length - 1, pending: {} } }));
    return true;
  };
  const readGroup = (group: string, consumer: string, count: number, pendingOnly: boolean) => {
    const g = groups[group];
    if (!consumer) return { error: { code: 'STREAMS_INPUT', message: 'group without consumer' } };
    if (!g) return { error: { code: 'NOGROUP', message: `NOGROUP No such key or consumer group '${group}'` } };
    if (pendingOnly) {
      const ids = g.pending[consumer] ?? [];
      return ids.map((id) => entries.find((e) => e.id === id) ?? { id, fields: {} });
    }
    const fresh = entries.slice(g.lastDelivered + 1, g.lastDelivered + 1 + count);
    if (!fresh.length) return [];
    setGroups((gs) => ({ ...gs, [group]: { ...g, lastDelivered: g.lastDelivered + fresh.length, pending: { ...g.pending, [consumer]: [...(g.pending[consumer] ?? []), ...fresh.map((e) => e.id)] } } }));
    setRead((r) => ({ ...r, [consumer]: [...(r[consumer] ?? []), ...fresh.map((e) => e.id)] }));
    return fresh;
  };
  const ack = (group: string, ids: string[]) => {
    const g = groups[group]; if (!g) return 0;
    let n = 0;
    const pending = Object.fromEntries(Object.entries(g.pending).map(([c, p]) => [c, p.filter((id) => { const hit = ids.includes(id); if (hit) n++; return !hit; })]));
    setGroups((gs) => ({ ...gs, [group]: { ...g, pending } }));
    return n;
  };
  const del = (ids: string[]) => { setEntries((e) => e.filter((x) => !ids.includes(x.id))); return ids.length; };
  return { entries, groups, read, add, createGroup, readGroup, ack, del };
}

export const STREAM_OPS: Record<string, OpSpec> = {
  createGroup: {
    fields: [{ name: 'group', label: 'group', kind: 'text' }, { name: 'start', label: 'start id', kind: 'select', options: ['$', '0'] }],
    examples: [
      { id: 'billing', title: 'Billing from now on', description: 'Only entries added after this.', values: { group: 'billing', start: '$' } },
      { id: 'audit', title: 'Audit replaying history', description: 'Start at 0: every existing entry.', values: { group: 'audit', start: '0' } },
    ],
    call: (v) => `await redis.streams.createGroup('orders', '${v.group}', '${v.start}')`,
  },
  add: {
    fields: [{ name: 'fields', label: 'fields (JSON)', kind: 'json' }],
    examples: [
      { id: 'event', title: 'Append an order event', description: 'Shows up in the follow pane right away.', values: { fields: '{ "orderId": "42", "type": "created" }' } },
      { id: 'empty', title: 'No fields', description: '→ STREAMS_INPUT.', values: { fields: '{}' } },
    ],
    call: (v) => `await redis.streams.add('orders', ${String(v.fields).replace(/\s+/g, ' ')})`,
  },
  read: {
    fields: [{ name: 'group', label: 'group', kind: 'text' }, { name: 'consumer', label: 'consumer', kind: 'text' }, { name: 'count', label: 'count', kind: 'number' }, { name: 'pending', label: 're-read my pending entries (id 0)', kind: 'boolean' }],
    examples: [
      { id: 'w1', title: 'New entries for worker-1', description: '">": entries become pending until acked.', values: { group: 'billing', consumer: 'worker-1', count: 2, pending: false } },
      { id: 'w2', title: 'worker-2 gets different ones', description: 'Each entry goes to one consumer in the group.', values: { group: 'billing', consumer: 'worker-2', count: 2, pending: false } },
      { id: 'recover', title: 'Recover pending', description: 'id 0 re-delivers what worker-1 never acked.', values: { group: 'billing', consumer: 'worker-1', count: 10, pending: true } },
      { id: 'ghost', title: 'Missing group', description: '→ NOGROUP from Redis.', values: { group: 'ghost', consumer: 'worker-1', count: 2, pending: false } },
    ],
    call: (v) => `await redis.streams.read('orders', { group: '${v.group}', consumer: '${v.consumer}', count: ${v.count}${v.pending ? ", id: '0'" : ''} })`,
  },
  ack: {
    fields: [{ name: 'group', label: 'group', kind: 'text' }, { name: 'ids', label: 'ids', kind: 'token' }],
    examples: [{ id: 'ack', title: 'Ack what I read', description: 'Clears it from the pending table.', values: { group: 'billing', ids: '$last' } }],
    call: (v) => `await redis.streams.ack('orders', '${v.group}', ...ids)`,
  },
};

export const SPECS: Record<string, Record<string, OpSpec>> = { lock: LOCK_OPS, 'rate-limit': RATE_OPS, pubsub: PUBSUB_OPS, streams: STREAM_OPS };
export type { Values };
