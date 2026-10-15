// Mock modules for the pub/sub and streams sections: in-memory stand-ins for their /api/:mode/...
// routes and SSE streams until the real backend exists. Behaviour is simplified.
'use client';

import { useRef, useState } from 'react';
import type { Mode } from '@showcase/contracts';
import type { RunResult } from './api';

let simId = 0;
/** A simulated operation's result as a RunResult, so mock sections share the real sections' form. Nothing was sent. */
export function simulated(mode: Mode, module: string, op: string, body: unknown): Promise<RunResult> {
  return Promise.resolve({
    id: --simId, at: new Date().toLocaleTimeString(), mode, module, op, input: '', httpStatus: 200, latencyMs: 0,
    body, keys: [], commands: ['(simulated: nothing sent)'],
  });
}

const rnd = (n = 6) => Math.random().toString(36).slice(2, 2 + n);

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

