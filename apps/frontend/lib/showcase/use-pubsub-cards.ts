// The pub/sub section's live state: one card per subscribe, each its own SSE stream on
// GET /api/:mode/pubsub/channels/:channel/stream (the backend subscribes when it opens and unsubscribes when it closes),
// and the recent publishes with how many open cards received each.
'use client';

import { PubSubStreamEventSchema, type Mode } from '@showcase/contracts';
import { useEffect, useRef, useState } from 'react';
import type { RunResult } from './api';

export interface Card {
  id: number; mode: Mode; channel: string;
  state: 'subscribing' | 'subscribed' | 'failed';
  error?: string;
  messages: { seq: number; value: unknown }[];
}
export interface Publish {
  id: number; mode: Mode; channel: string; raw: boolean;
  /** The message as the cards would receive it (JSON text), to match deliveries to this publish. */
  text: string;
  /** What publish returned; null until it answers, or when it failed. */
  returned: number | null;
  /** The cards that received it. */
  receivedBy: number[];
}

const MESSAGES_KEPT = 20;
const PUBLISHES_KEPT = 10;

let nextId = 0;

export function usePubSubCards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [publishes, setPublishes] = useState<Publish[]>([]);
  const sources = useRef(new Map<number, EventSource>());
  // Subscribes still waiting for Redis's confirmation, settled as cancelled if their card closes first.
  const waiting = useRef(new Map<number, () => void>());
  const seq = useRef(0);

  // Leaving the section closes every card: the backend unsubscribes them.
  useEffect(() => {
    const open = sources.current;
    const pending = waiting.current;
    return () => {
      for (const source of open.values()) source.close();
      open.clear();
      for (const cancel of pending.values()) cancel();
      pending.clear();
    };
  }, []);

  const update = (id: number, change: (card: Card) => Card) => setCards((cs) => cs.map((c) => (c.id === id ? change(c) : c)));

  /** Opens a card; resolves once Redis confirmed the subscription (or it failed), as the subscribe's result. */
  const subscribe = (mode: Mode, channel: string): Promise<RunResult> => {
    const id = ++nextId;
    const started = performance.now();
    setCards((cs) => [...cs, { id, mode, channel, state: 'subscribing', messages: [] }]);
    const source = new EventSource(`/api/${mode}/pubsub/channels/${encodeURIComponent(channel)}/stream`);
    sources.current.set(id, source);
    return new Promise((resolve) => {
      const done = (httpStatus: number, body: unknown) => {
        waiting.current.delete(id);
        resolve({
          id, at: new Date().toLocaleTimeString(), mode, module: 'pubsub', op: 'subscribe', input: JSON.stringify({ channel }),
          httpStatus, latencyMs: +(performance.now() - started).toFixed(1), body, keys: [], commands: [],
        });
      };
      waiting.current.set(id, () => done(0, { error: { code: 'CLOSED', message: 'the card closed before Redis confirmed the subscription' } }));
      source.onmessage = (event) => {
        const parsed = PubSubStreamEventSchema.safeParse(JSON.parse(event.data));
        if (!parsed.success) return;
        const data = parsed.data;
        if (data.type === 'subscribed') {
          update(id, (c) => ({ ...c, state: 'subscribed' }));
          done(200, data);
        } else if (data.type === 'error') {
          // The backend ended the stream: stop the browser from reconnecting into the same failure.
          source.close();
          sources.current.delete(id);
          update(id, (c) => ({ ...c, state: 'failed', error: `${data.error.code}: ${data.error.message}` }));
          done(500, { error: data.error });
        } else {
          const s = ++seq.current;
          const text = JSON.stringify(data.value);
          update(id, (c) => ({ ...c, messages: [{ seq: s, value: data.value }, ...c.messages].slice(0, MESSAGES_KEPT) }));
          // Credit the oldest publish of this text on this channel that this card hasn't received yet.
          setPublishes((ps) => {
            const match = [...ps].reverse().find((p) => p.mode === mode && p.channel === data.channel && p.text === text && !p.receivedBy.includes(id));
            return match ? ps.map((p) => (p === match ? { ...p, receivedBy: [...p.receivedBy, id] } : p)) : ps;
          });
        }
      };
      // A stream that can't open answers like the mode guard would, as JSON we can't read here: show it as lost.
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) {
          sources.current.delete(id);
          update(id, (c) => ({ ...c, state: 'failed', error: 'stream closed by the backend' }));
          done(0, { error: { code: 'STREAM_FAILED', message: 'the stream could not be opened' } });
        }
      };
    });
  };

  /** Closes a card: its stream ends, and the backend unsubscribes it (UNSUBSCRIBE if it was the channel's last). */
  const unsubscribe = (id: number) => {
    waiting.current.get(id)?.();
    sources.current.get(id)?.close();
    sources.current.delete(id);
    setCards((cs) => cs.filter((c) => c.id !== id));
  };

  /** Records a publish before it is sent (a card can receive it before publish answers), then sends it. */
  const publish = async (mode: Mode, channel: string, raw: boolean, text: string, send: () => Promise<RunResult>) => {
    const id = ++nextId;
    setPublishes((ps) => [{ id, mode, channel, raw, text, returned: null, receivedBy: [] }, ...ps].slice(0, PUBLISHES_KEPT));
    const r = await send();
    const returned = r.httpStatus === 200 && typeof r.body === 'number' ? r.body : null;
    setPublishes((ps) => ps.map((p) => (p.id === id ? { ...p, returned } : p)));
    return r;
  };

  return { cards, publishes, subscribe, unsubscribe, publish };
}
