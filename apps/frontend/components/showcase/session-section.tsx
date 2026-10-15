// The session section: log in (a fake login: any user id) and use the session with validate, get, touch and update,
// each with editable examples. Beside the form, this browser's cookie for the mode and the last Set-Cookie the package
// built; below, the session the package returned next to what Redis stores for it, which is ciphertext.
'use client';

import { Cookie, Database, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { perMode, useOnReset } from '@/lib/showcase/per-mode';
import { usePolled } from '@/lib/showcase/use-polled';
import { SessionCookieSchema, SessionStoredSchema, type Mode, type SessionCookie } from '@showcase/contracts';
import { OpForm } from './op-form';
import { Json } from './result-display';

const OPS = ['create', 'validate', 'get', 'touch', 'update'];

/** The fields of a session record this section uses; the rest is shown as returned. */
interface Session { id: string; userId: string; [field: string]: unknown }
/** Per mode: the last session the package returned (and from which call), and the last Set-Cookie a response carried. */
interface Known { session: Session | null; from: string; setCookie: string | null }

const short = (token: string) => `${token.split('.')[0].slice(0, 8)}…`;

/** The session in a successful result: create's and a valid validate's `session`, or get's and update's result itself. */
function sessionIn(op: string, result: unknown): Session | null {
  const r = result as { session?: Session; valid?: boolean } & Partial<Session> | null;
  if (op === 'create' || op === 'validate') return r?.session ?? null;
  if (op === 'get' || op === 'update') return r?.id && r.userId ? (r as Session) : null;
  return null;
}

/** The stored value, pretty-printed when it is JSON (the encryption envelope is). */
function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function BrowserCard({ mode, cookie, setCookie }: { mode: Mode; cookie: SessionCookie | null; setCookie: string | null }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Cookie className="size-4" /> This browser · {mode}</CardTitle>
        <CardDescription>The cookie is HttpOnly, so the page can&apos;t read it: the backend reports what the request carried.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Cookie <span className="font-mono">{cookie?.name ?? '…'}</span></div>
          <code className="block break-all rounded-md bg-code p-2 font-mono text-xs text-code-foreground">
            {!cookie ? 'reading…' : cookie.value ?? '(not set)'}
          </code>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Last Set-Cookie (from <span className="font-mono">sessions.cookie()</span>)</div>
          <code className="block break-all rounded-md bg-code p-2 font-mono text-xs text-code-foreground">{setCookie ?? '(none yet: log in)'}</code>
        </div>
      </CardContent>
    </Card>
  );
}

/** The session as the package returned it, next to the record as Redis holds it (native GET + TTL, re-read every second). */
function StoredCard({ mode, known, refresh }: { mode: Mode; known: Known & { session: Session }; refresh: number }) {
  const { session, from } = known;
  const stored = usePolled(
    `/api/${mode}/session/stored?${new URLSearchParams({ userId: session.userId, id: session.id })}`, SessionStoredSchema, 1000, refresh,
  );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="size-4" /> {session.userId}&apos;s session on {mode}</CardTitle>
        <CardDescription>
          Session encryption is on (AES-256-GCM, key version v1): Redis holds only ciphertext, and the package decrypts it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-muted-foreground">
            Decrypted, as <span className="font-mono">sessions.{from}()</span> returned it. A later touch rewrites the
            record without returning it: run get to decrypt it again.
          </div>
          <Json value={session} />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="size-3.5" /> Stored, read with a native GET (not a package call)
            {stored && <Badge variant="outline" className="ml-auto font-mono">{stored.value === null ? 'gone' : stored.ttl === null ? 'no expiry' : `TTL ${stored.ttl}s`}</Badge>}
          </div>
          <div className="break-all font-mono text-[11px] text-muted-foreground">{stored?.key ?? 'reading…'}</div>
          {stored && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-code p-3 font-mono text-xs leading-relaxed text-code-foreground">
              {stored.value === null ? '(nil): the key is gone' : pretty(stored.value)}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SessionSection({ mode, resets, onResult }: { mode: Mode; resets: Record<Mode, number>; onResult: (r: RunResult) => void }) {
  const [known, setKnown] = useState(() => perMode<Known>(() => ({ session: null, from: '', setCookie: null })));
  // Reset section deleted every record: the session shown is gone. The last Set-Cookie still is what the browser was told.
  useOnReset(resets, (m) => setKnown((k) => ({ ...k, [m]: { ...k[m], session: null, from: '' } })));
  // Bumped after every run, so the cookie and the stored record are re-read straight away.
  const [runs, setRuns] = useState(0);
  const cookie = usePolled(`/api/${mode}/session/cookie`, SessionCookieSchema, 5000, runs);

  const run = async (op: string, v: Values) => {
    const at = mode;
    const r = await runOperation(at, 'session', op, () => spec('session', op).body!(v));
    const session = r.httpStatus === 200 ? sessionIn(op, r.body) : null;
    setKnown((k) => ({
      ...k,
      [at]: { ...(session ? { session, from: op } : k[at]), setCookie: r.setCookie ?? k[at].setCookie },
    }));
    setRuns((n) => n + 1);
    return r;
  };
  const tokens = [{ value: '$cookie', label: `my cookie${cookie?.value ? ` (${short(cookie.value)})` : ' (none)'}` }];
  const current = known[mode];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
        <OpForm module="session" ops={OPS} mode={mode} tokens={tokens} onRun={run} onResult={onResult} />
        <BrowserCard mode={mode} cookie={cookie} setCookie={current.setCookie} />
      </div>
      {current.session ? (
        <StoredCard mode={mode} known={{ ...current, session: current.session }} refresh={runs} />
      ) : (
        <p className="text-sm text-muted-foreground">Log in (create) to see the session next to what Redis stores for it.</p>
      )}
    </div>
  );
}
