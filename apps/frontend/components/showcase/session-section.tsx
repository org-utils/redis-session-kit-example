// The session section: every session operation with editable examples, from a fake login (create, any user id) through
// rotation, revocation and the user-level calls. Beside the form, this browser: the mode's cookie, the last Set-Cookie
// the package built and the token wallet, every credential handed to this browser on the mode. Below, the session the
// package returned next to what Redis stores for it (ciphertext), and the live table of every record Redis holds for the
// user, tombstones included.
'use client';

import { ArrowLeft, ArrowRight, Cookie, Database, KeyRound, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { SESSION_OPS } from '@/lib/showcase/mock-backend';
import { perMode, useOnReset } from '@/lib/showcase/per-mode';
import { usePolled } from '@/lib/showcase/use-polled';
import { cn } from '@/lib/utils';
import {
  SessionCookieSchema, SessionRecordsSchema, SessionStoredSchema, type Mode, type SessionCookie, type SessionInvalidReason,
  type SessionRecords,
} from '@showcase/contracts';
import { OpForm } from './op-form';
import { Json } from './result-display';

/** The fields of a session record this section uses; the rest is shown as returned. */
interface Session { id: string; jti: string; userId: string; deviceId?: string; [field: string]: unknown }
/** A credential this browser was handed on a mode, by a login or a rotation. */
interface WalletEntry { token: string; id: string; jti: string; userId: string; deviceId?: string; via: 'create' | 'rotate' }
/** Per mode: what this browser was handed and what the section last saw. */
interface Known {
  /** The last session the package returned, and from which call. */
  session: Session | null; from: string;
  /** The last Set-Cookie a response carried. */
  setCookie: string | null;
  /** Oldest first. */
  wallet: WalletEntry[];
  /** The token the last rotation consumed: `$previous` in the token field. */
  previous: string | null;
  /** Whose sessions the table shows: the user of the last operation. */
  userId: string;
}
type Row = SessionRecords['sessions'][number];

/** A token or jti, short enough to tell apart. */
const short = (value: string) => `${value.split('.')[0].slice(0, 8)}…`;
const secs = (s: number) => (s <= 0 ? 'now' : s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);
const USER_OPS = ['setSecurityVersion', 'revokeAll', 'list'];

/** The session in a successful result: create's, rotate's and a valid validate's `session`, or get's and update's result. */
function sessionIn(op: string, result: unknown): Session | null {
  const r = result as { session?: Session; valid?: boolean } & Partial<Session> | null;
  if (op === 'create' || op === 'rotate' || op === 'validate') return r?.session ?? null;
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

/** A record's state: its stored status, and when it is active but can't authenticate, why (validate's reason). */
function StateBadge({ status, reason }: { status: 'active' | 'consumed' | 'revoked' | 'gone'; reason: SessionInvalidReason | null }) {
  if (status === 'gone') return <Badge variant="outline">gone</Badge>;
  if (status === 'consumed') return <Badge variant="secondary">consumed</Badge>;
  if (status === 'revoked') return <Badge variant="destructive">revoked</Badge>;
  if (reason) return <Badge className="bg-warning text-warning-foreground">active · {reason}</Badge>;
  return <Badge className="bg-success text-success-foreground">active</Badge>;
}

function WalletState({ entry, records }: { entry: WalletEntry; records: SessionRecords | null }) {
  if (!records) return null;
  if (records.userId !== entry.userId) return <Badge variant="outline" className="font-mono">{entry.userId}</Badge>;
  const row = records.sessions.find((r) => r.session?.id === entry.id);
  return row?.session ? <StateBadge status={row.session.status} reason={row.reason} /> : <StateBadge status="gone" reason={null} />;
}

function BrowserCard({ mode, cookie, known, records }: {
  mode: Mode; cookie: SessionCookie | null; known: Known; records: SessionRecords | null;
}) {
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
          <div className="text-xs text-muted-foreground">Last Set-Cookie (from <span className="font-mono">sessions.cookie()</span> or <span className="font-mono">deletionCookie()</span>)</div>
          <code className="block break-all rounded-md bg-code p-2 font-mono text-xs text-code-foreground">{known.setCookie ?? '(none yet: log in)'}</code>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="size-3.5" /> Token wallet: every credential handed to this browser</div>
          {known.wallet.length ? (
            <ul className="space-y-1 font-mono text-xs">
              {known.wallet.toReversed().map((w) => (
                <li key={w.token} className="flex items-center gap-2">
                  <span className="text-code-key">{short(w.jti)}</span>
                  <span className="truncate text-muted-foreground">{w.deviceId ?? w.userId} · {w.via}</span>
                  {w.token === cookie?.value && <Cookie className="size-3.5 shrink-0" aria-label="in the cookie" />}
                  <span className="ml-auto shrink-0"><WalletState entry={w} records={records} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Empty: log in (create) to be handed a token.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** The session as the package returned it, next to the record as Redis holds it (native GET + TTL, re-read every second). */
function StoredCard({ mode, session, from, refresh }: { mode: Mode; session: Session; from: string; refresh: number }) {
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
            Decrypted, as <span className="font-mono">sessions.{from}()</span> returned it. A later touch, rotate or revoke
            rewrites the record without returning it: the table below decrypts what is stored now.
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

function SessionRow({ row, now, securityVersion, cookieId }: { row: Row; now: number; securityVersion: number | null; cookieId?: string }) {
  const s = row.session;
  if (!s) {
    return (
      <TableRow>
        <TableCell colSpan={8} className="font-mono text-muted-foreground">
          {row.key}: can&apos;t be decrypted with this backend&apos;s key v1 (written under another SESSION_ENCRYPTION_KEY, such as the test suite&apos;s)
        </TableCell>
      </TableRow>
    );
  }
  const active = s.status === 'active';
  const hardExpiry = Math.min(s.expiresAt, s.absoluteExpiresAt ?? Infinity);
  return (
    <TableRow>
      <TableCell className="font-mono text-code-key">
        <span className="flex items-center gap-2">{short(s.jti)}{s.id === cookieId && <Badge variant="outline"><Cookie /> cookie</Badge>}</span>
      </TableCell>
      <TableCell>{s.deviceId ?? '—'}</TableCell>
      <TableCell><StateBadge status={s.status} reason={row.reason} /></TableCell>
      <TableCell className="font-mono">
        v{s.version} · <span className={cn(s.securityVersion !== securityVersion && 'text-destructive')} title="the security version it was created with">sv{s.securityVersion ?? '—'}</span>
      </TableCell>
      <TableCell className="font-mono">{active && s.idleExpiresAt !== null ? secs(s.idleExpiresAt - now) : '—'}</TableCell>
      <TableCell className="font-mono">
        {active ? secs(hardExpiry - now) : row.ttl === null ? 'no expiry' : `tombstone ${secs(row.ttl)}`}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        <span className="flex items-center gap-1">
          {s.rotatedFrom && <><ArrowLeft className="size-3" />{short(s.rotatedFrom)}</>}
          {s.successorJti && <><ArrowRight className="size-3" />{short(s.successorJti)}</>}
          {!s.rotatedFrom && !s.successorJti && '—'}
        </span>
      </TableCell>
      <TableCell>{row.inSessionSet ? 'yes' : 'no'}</TableCell>
    </TableRow>
  );
}

/** Every record Redis holds for the user on this mode, read natively and decrypted, re-read every second. */
function SessionsTable({ mode, userId, records, cookieId }: { mode: Mode; userId: string; records: SessionRecords | null; cookieId?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" /> {userId}&apos;s sessions on {mode}</CardTitle>
        <CardDescription>
          Every record Redis holds for this user, tombstones included (a SCAN of the user&apos;s slot, decrypted; not a
          package call: <span className="font-mono">list()</span> leaves tombstones out). It follows the user of the last
          operation. Countdowns use Redis server time.
        </CardDescription>
        {records && (
          <CardAction>
            <Badge variant="outline" className="font-mono">security version {records.securityVersion ?? 'none'}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>session (jti)</TableHead><TableHead>device</TableHead><TableHead>state</TableHead>
              <TableHead>version · security</TableHead><TableHead>idle left</TableHead><TableHead>expires in</TableHead>
              <TableHead>rotation chain</TableHead><TableHead>in session set</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records?.sessions.map((row) => (
              <SessionRow key={row.key} row={row} now={records.serverTime} securityVersion={records.securityVersion} cookieId={cookieId} />
            ))}
            {records && !records.sessions.length && (
              <TableRow><TableCell colSpan={8} className="text-muted-foreground">No records for {userId}. Run “Log in on a laptop” (create).</TableCell></TableRow>
            )}
            {!records && <TableRow><TableCell colSpan={8} className="text-muted-foreground">reading…</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** What a run tells the section: the operation, its form values and the credential they presented, and what came back. */
interface Ran { op: string; v: Values; presented: string | null; r: RunResult; session: Session | null }

/** A mode's Known after a run. */
function afterRun(was: Known, { op, v, presented, r, session }: Ran): Known {
  const ok = r.httpStatus === 200;
  // A login or a rotation hands this browser a credential: it joins the wallet.
  type Handed = { token: string; session: Session; previousJti?: string };
  const handed = ok && (op === 'create' || op === 'rotate') ? (r.body as Handed) : null;
  const wallet = handed
    ? [...was.wallet, {
      token: handed.token, id: handed.session.id, jti: handed.session.jti, userId: handed.session.userId,
      deviceId: handed.session.deviceId, via: op as WalletEntry['via'],
    }]
    : was.wallet;
  // What a rotation consumed: the wallet's entry with the predecessor's jti, else the credential the form presented.
  const previous = handed?.previousJti
    ? was.wallet.find((w) => w.jti === handed.previousJti)?.token ?? presented
    : was.previous;
  const userId = session?.userId ?? (ok && USER_OPS.includes(op) ? String(v.userId) : was.userId);
  return { ...was, ...(session && { session, from: op }), setCookie: r.setCookie ?? was.setCookie, wallet, previous, userId };
}

export function SessionSection({ mode, resets, onResult }: { mode: Mode; resets: Record<Mode, number>; onResult: (r: RunResult) => void }) {
  const [known, setKnown] = useState(() => perMode<Known>(() => ({
    session: null, from: '', setCookie: null, wallet: [], previous: null, userId: 'user-42',
  })));
  // Reset section deleted every record: the session shown and the wallet's credentials are gone. The last Set-Cookie
  // still is what the browser was told.
  useOnReset(resets, (m) => setKnown((k) => ({ ...k, [m]: { ...k[m], session: null, from: '', wallet: [], previous: null } })));
  // Bumped after every run, so the cookie, the stored record and the table are re-read straight away.
  const [runs, setRuns] = useState(0);
  const cookie = usePolled(`/api/${mode}/session/cookie`, SessionCookieSchema, 5000, runs);
  const current = known[mode];
  const records = usePolled(
    `/api/${mode}/session/records?${new URLSearchParams({ userId: current.userId })}`, SessionRecordsSchema, 1000, runs,
  );

  const run = async (op: string, v: Values) => {
    const at = mode;
    const { previous } = known[at];
    const r = await runOperation(at, 'session', op, () => {
      if (v.token === '$previous' && !previous) throw new Error(`no rotation on ${at} yet: there is no token before the last one`);
      return spec('session', op).body!(v.token === '$previous' ? { ...v, token: previous! } : v);
    });
    const session = r.httpStatus === 200 ? sessionIn(op, r.body) : null;
    // The credential the form presented: the cookie as last read, the token before the last rotation, or a typed one.
    const presented = v.token === '$cookie' ? cookie?.value ?? null : v.token === '$previous' ? previous : String(v.token ?? '');
    setKnown((k) => ({ ...k, [at]: afterRun(k[at], { op, v, presented, r, session }) }));
    setRuns((n) => n + 1);
    return r;
  };

  const tokens = [
    { value: '$cookie', label: `my cookie${cookie?.value ? ` (${short(cookie.value)})` : ' (none)'}` },
    { value: '$previous', label: `token before the last rotation${current.previous ? ` (${short(current.previous)})` : ' (none yet)'}` },
    ...current.wallet.toReversed().map((w) => ({ value: w.token, label: `wallet: ${short(w.jti)} · ${w.deviceId ?? w.userId} · ${w.via}` })),
  ];
  const cookieId = current.wallet.find((w) => w.token === cookie?.value)?.id;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
        <OpForm module="session" ops={SESSION_OPS} mode={mode} tokens={tokens} onRun={run} onResult={onResult} />
        <BrowserCard mode={mode} cookie={cookie} known={current} records={records} />
      </div>
      <SessionsTable mode={mode} userId={current.userId} records={records} cookieId={cookieId} />
      {current.session ? (
        <StoredCard mode={mode} session={current.session} from={current.from} refresh={runs} />
      ) : (
        <p className="text-sm text-muted-foreground">Log in (create) to see the session next to what Redis stores for it.</p>
      )}
    </div>
  );
}
