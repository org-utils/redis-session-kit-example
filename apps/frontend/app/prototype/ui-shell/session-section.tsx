// PROTOTYPE: three ways for the session section to walk someone through the session lifecycle, inside variant A.
// ?session=1 operations + browser panel · ?session=2 guided walkthrough · ?session=3 session board.
'use client';

import { ArrowRight, Check, CircleDot, Cookie, Laptop, LogIn, Play, RotateCcw, ShieldAlert, Smartphone, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { HttpBadge, Json } from './bits';
import { spec, type Values } from './examples';
import { RequestForm, type TokenOption } from './request-form';
import { DEMO_CONFIG, type Rec, type Status, type Transition, type useSessionLab } from './session-sim';
import type { Mode, RunResult } from './stub';

type Lab = ReturnType<typeof useSessionLab>;
interface SectionProps { mode: Mode; lab: Lab; onResult: (r: RunResult) => void; last: RunResult | null }

/* ---------- shared bits (compositions of shadcn primitives) ---------- */

function useNow() {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);
  return n;
}
const secs = (s: number) => (s <= 0 ? 'now' : s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

function StateBadge({ status, reason }: { status: Status | 'gone'; reason?: string }) {
  if (reason && status === 'active') return <Badge className="bg-warning text-warning-foreground">{reason}</Badge>;
  if (status === 'active') return <Badge className="bg-success text-success-foreground">active</Badge>;
  if (status === 'consumed') return <Badge variant="secondary">consumed</Badge>;
  if (status === 'revoked') return <Badge variant="destructive">revoked</Badge>;
  return <Badge variant="outline">gone</Badge>;
}

function tokenOptions(lab: Lab): TokenOption[] {
  return [
    { value: '$cookie', label: `my cookie${lab.cookie ? ` (${lab.cookie.split('.')[0]})` : ' (none)'}` },
    { value: '$previous', label: `token before the last rotation${lab.previous ? ` (${lab.previous.split('.')[0]})` : ' (none yet)'}` },
    ...lab.wallet.map((w) => ({ value: w.token, label: `${w.jti} · ${w.label}` })),
  ];
}

function BrowserCard({ mode, lab, last }: { mode: Mode; lab: Lab; last: RunResult | null }) {
  const setCookie = (last as (RunResult & { setCookie?: string }) | null)?.setCookie;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Cookie className="size-4" /> This browser · {mode}</CardTitle>
        <CardDescription>What the cookie holds, and every token this browser was ever given.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Cookie <span className="font-mono">showcase_session_{mode}</span></div>
          <code className="block break-all rounded-md bg-code p-2 font-mono text-xs text-code-foreground">{lab.cookie ?? '(not set)'}</code>
        </div>
        {setCookie && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Last Set-Cookie (from <span className="font-mono">sessions.cookie()</span>)</div>
            <code className="block break-all rounded-md bg-code p-2 font-mono text-xs text-code-foreground">{setCookie}</code>
          </div>
        )}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Token wallet</div>
          {lab.wallet.length ? (
            <ul className="space-y-0.5 font-mono text-xs">
              {lab.wallet.map((w) => {
                const c = lab.sim.check(w.token);
                return (
                  <li key={w.token} className="flex items-center gap-2">
                    <span className="text-code-key">{w.jti}</span><span className="truncate text-muted-foreground">{w.label}</span>
                    <span className="ml-auto">{c.valid ? <StateBadge status="active" /> : <Badge variant="outline">{c.reason}</Badge>}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Log in to get a token.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** ACTIVE → CONSUMED / REVOKED, EXPIRED derived, any → DELETED; lights up the last transition. */
function StateDiagram({ t }: { t: Transition | null }) {
  const on = (from: string, to: string) => t && (t.from === from || from === '*') && t.to === to;
  const Node = ({ s, cls }: { s: string; cls: string }) => (
    <Badge variant="outline" className={cn('font-mono', (t?.to === s.toLowerCase() || t?.from === s.toLowerCase()) && cls)}>{s}</Badge>
  );
  const Edge = ({ lit, label }: { lit: boolean | null; label: string }) => (
    <span className={cn('flex items-center gap-1 text-[10px] text-muted-foreground', lit && 'font-semibold text-foreground')}>
      <ArrowRight className="size-3" />{label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="mr-1 text-xs text-muted-foreground">State machine</span>
      <Edge lit={on('none', 'active')} label="create" />
      <Node s="ACTIVE" cls="border-success text-success" />
      <Edge lit={on('active', 'consumed')} label="rotate" />
      <Node s="CONSUMED" cls="border-foreground" />
      <Separator orientation="vertical" className="h-4" />
      <Node s="ACTIVE" cls="" />
      <Edge lit={on('active', 'revoked')} label="revoke" />
      <Node s="REVOKED" cls="border-destructive text-destructive" />
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs text-muted-foreground">EXPIRED is derived from time</span>
      <Separator orientation="vertical" className="h-4" />
      <Edge lit={t?.to === 'deleted'} label="destroy / revokeAll / TTL" />
      <Node s="DELETED" cls="border-foreground" />
    </div>
  );
}

function ResultCard({ r }: { r: RunResult | null }) {
  if (!r) return null;
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-mono text-sm">sessions.{r.op}()</CardTitle>
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">{r.latencyMs}ms <HttpBadge code={r.httpStatus} /></div>
      </CardHeader>
      <CardContent><Json value={r.body} /></CardContent>
    </Card>
  );
}

function useOpForm(op: string) {
  const s = spec('session', op);
  const [exampleId, setExampleId] = useState(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  useEffect(() => { setExampleId(s.examples[0].id); setValues(s.examples[0].values); }, [op]); // eslint-disable-line react-hooks/exhaustive-deps
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  return { s, exampleId, setExampleId, values, setValues, example, modified };
}

/* ---------- variant 1: operations + browser panel ---------- */

const OPS = ['create', 'validate', 'get', 'touch', 'update', 'rotate', 'revoke', 'destroy', 'setSecurityVersion', 'revokeAll', 'list'];

function SessionOps({ mode, lab, onResult, last }: SectionProps) {
  const [op, setOp] = useState('create');
  const f = useOpForm(op);
  const now = useNow();
  const user = 'user-42';
  const listed = lab.sim.all(user).live;
  return (
    <div className="space-y-5">
      <Tabs value={op} onValueChange={setOp}>
        <TabsList variant="line" className="h-auto flex-wrap">{OPS.map((o) => <TabsTrigger key={o} value={o} className="font-mono">{o}</TabsTrigger>)}</TabsList>
      </Tabs>
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <RequestForm spec={f.s} values={f.values} modified={f.modified} onChange={f.setValues} tokens={tokenOptions(lab)}
            selected={f.modified ? null : f.exampleId} onPick={(e) => { f.setExampleId(e.id); f.setValues(e.values); }}
            onReset={() => f.example && f.setValues(f.example.values)}
            footer={<Button onClick={() => onResult(lab.run(op, f.values))}><Play /> Run on {mode}</Button>} />
          <ResultCard r={last} />
        </div>
        <BrowserCard mode={mode} lab={lab} last={last} />
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" /> {user}&apos;s sessions on {mode}</CardTitle>
          <CardDescription>Every record Redis holds for this user, tombstones included. Countdowns use the server clock.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>session</TableHead><TableHead>device</TableHead><TableHead>state</TableHead><TableHead>version</TableHead><TableHead>idle left</TableHead><TableHead>expires in</TableHead><TableHead>chain</TableHead></TableRow></TableHeader>
            <TableBody>
              {listed.map((r) => {
                const c = lab.sim.check(r.token);
                return (
                  <TableRow key={r.jti}>
                    <TableCell className="font-mono text-code-key">{r.jti}{r.token === lab.cookie && <Badge variant="outline" className="ml-2"><Cookie /> cookie</Badge>}</TableCell>
                    <TableCell>{r.deviceId}</TableCell>
                    <TableCell><StateBadge status={r.status} reason={!c.valid && r.status === 'active' ? c.reason : undefined} /></TableCell>
                    <TableCell className="font-mono">v{r.version} · sv{r.securityVersion}</TableCell>
                    <TableCell className="font-mono">{r.status === 'active' && r.idleExpiresAt ? secs(r.idleExpiresAt - now) : '—'}</TableCell>
                    <TableCell className="font-mono">{r.tombstoneUntil ? `tombstone ${secs(r.tombstoneUntil - now)}` : secs(Math.min(r.expiresAt, r.absoluteAt) - now)}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{r.predecessorJti && `← ${r.predecessorJti}`} {r.successorJti && `→ ${r.successorJti}`}</TableCell>
                  </TableRow>
                );
              })}
              {!listed.length && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No sessions yet. Run “Log in on a laptop”.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- variant 2: guided walkthrough ---------- */

interface Step { title: string; op: string; example: string; story: string; notice: string }
const STEPS: Step[] = [
  { title: 'Log in', op: 'create', example: 'browser', story: 'A fake login: any user id, no password. The package returns the raw token exactly once; the showcase puts it in this mode\'s cookie.', notice: 'Three keys appear in the Redis-state panel: the record, the user\'s session set and the token locator.' },
  { title: 'Check the cookie', op: 'validate', example: 'cookie', story: 'Every authenticated request validates the cookie.', notice: 'validate never throws for a bad credential: it answers { valid, reason }.' },
  { title: 'Stay active', op: 'touch', example: 'touch', story: 'Touch on each request to roll the idle expiry forward. Run it twice quickly.', notice: 'The second touch within 10 s (touchInterval) writes nothing: touched: false.' },
  { title: 'Save a preference', op: 'update', example: 'cas', story: 'Update metadata with the version you read (1). Then run it again unchanged.', notice: 'The second run carries a stale expectedVersion: SESSION_CONFLICT instead of a lost update.' },
  { title: 'Rotate', op: 'rotate', example: 'current', story: 'After a privilege change, rotate: the session is consumed and a successor replaces it.', notice: 'The cookie moves to the successor; the predecessor is now a consumed tombstone (≤ 300 s).' },
  { title: 'Replay the old token', op: 'rotate', example: 'replay', story: 'Someone presents the token from before the rotation.', notice: 'SessionReplayError. Replay alone ends no session: the successor stays active.' },
  { title: 'Log out with a stale cookie', op: 'revoke', example: 'stale', story: 'A tab still holding the old token logs out.', notice: 'revoke follows the rotation chain from the consumed token and revokes the session at its end.' },
  { title: 'Log in on a phone', op: 'create', example: 'phone', story: 'The same user signs in on another device.', notice: 'A new active session; the user\'s session set lists it.' },
  { title: 'Reset the password', op: 'setSecurityVersion', example: 'reset', story: 'Bump the user\'s security version to 2.', notice: 'Nothing is deleted, but every session created with version 1 now validates as invalid.' },
  { title: 'See the phone fail', op: 'validate', example: 'cookie', story: 'Validate the phone\'s cookie.', notice: '{ valid: false, reason: "invalid" }: the version no longer matches.' },
  { title: 'Log out everywhere', op: 'revokeAll', example: 'all', story: 'Clean up every session of the user.', notice: 'Deleted outright, no tombstones: the tokens now answer not_found.' },
];

function SessionWalkthrough({ mode, lab, onResult, last }: SectionProps) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState<Record<number, RunResult>>({});
  const step = STEPS[i];
  const s = spec('session', step.op);
  const ex = s.examples.find((e) => e.id === step.example)!;
  const [values, setValues] = useState<Values>(ex.values);
  useEffect(() => setValues(ex.values), [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const modified = JSON.stringify(values) !== JSON.stringify(ex.values);
  const r = done[i];
  const run = () => { const res = lab.run(step.op, values); setDone((d) => ({ ...d, [i]: res })); onResult(res); };

  return (
    <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-[14rem_minmax(0,1fr)]">
      <nav className="space-y-1">
        <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Walkthrough · {mode}</div>
        {STEPS.map((st, n) => (
          <Button key={n} variant={n === i ? 'secondary' : 'ghost'} size="sm" onClick={() => setI(n)} className="w-full justify-start gap-2">
            <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]', done[n] && 'border-success bg-success text-success-foreground')}>
              {done[n] ? <Check className="size-3" /> : n + 1}
            </span>
            <span className="truncate">{st.title}</span>
          </Button>
        ))}
      </nav>
      <div className="space-y-4">
        <StateDiagram t={lab.lastTransition} />
        <Card>
          <CardHeader>
            <CardDescription>Step {i + 1} of {STEPS.length}</CardDescription>
            <CardTitle className="text-xl">{step.title}</CardTitle>
            <CardAction className="font-mono text-xs text-muted-foreground">sessions.{step.op}()</CardAction>
          </CardHeader>
          <CardContent><p className="text-sm">{step.story}</p></CardContent>
        </Card>
        <RequestForm spec={s} values={values} modified={modified} onChange={setValues} tokens={tokenOptions(lab)} onReset={() => setValues(ex.values)}
          selected={modified ? null : ex.id} onPick={(e) => setValues(e.values)}
          footer={<>
            <Button onClick={run}><Play /> Run step</Button>
            <Button variant="outline" disabled={i === STEPS.length - 1} onClick={() => setI(i + 1)}>Next <ArrowRight /></Button>
          </>} />
        {r && (
          <Alert variant={r.httpStatus >= 400 ? 'destructive' : 'default'}>
            <CircleDot />
            <AlertTitle className="flex items-center gap-2">What to notice <HttpBadge code={r.httpStatus} /></AlertTitle>
            <AlertDescription>{step.notice}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
          <ResultCard r={r ?? null} />
          <BrowserCard mode={mode} lab={lab} last={last} />
        </div>
      </div>
    </div>
  );
}

/* ---------- variant 3: session board ---------- */

function SessionCard({ r, lab, mode, onResult, now }: { r: Rec; lab: Lab; mode: Mode; onResult: (x: RunResult) => void; now: number }) {
  const c = lab.sim.check(r.token);
  const act = (op: string, extra: Values = {}) => onResult(lab.run(op, { token: r.token, ...extra }));
  const idleLeft = r.idleExpiresAt ? r.idleExpiresAt - now : null;
  const DeviceIcon = r.deviceId === 'phone' ? Smartphone : Laptop;
  return (
    <Card size="sm" className={cn('gap-2', r.token === lab.cookie && 'ring-2 ring-primary')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-sm"><DeviceIcon className="size-4" />{r.jti}</CardTitle>
        <CardDescription className="text-xs">{r.userId} · {r.deviceId} · v{r.version} · sv{r.securityVersion}</CardDescription>
        <CardAction><StateBadge status={r.status} reason={!c.valid && r.status === 'active' ? c.reason : undefined} /></CardAction>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {r.token === lab.cookie && <Badge variant="outline"><Cookie /> this browser&apos;s cookie</Badge>}
        {r.status === 'active' && idleLeft !== null && r.idleTimeout && (
          <div className="space-y-1">
            <div className="flex justify-between text-muted-foreground"><span>idle</span><span className="font-mono">{secs(idleLeft)}</span></div>
            <Progress value={Math.max(0, (idleLeft / r.idleTimeout) * 100)} />
          </div>
        )}
        <div className="flex justify-between text-muted-foreground">
          <span>{r.tombstoneUntil ? 'tombstone ends' : 'expires'}</span>
          <span className="font-mono">{secs((r.tombstoneUntil ?? Math.min(r.expiresAt, r.absoluteAt)) - now)}</span>
        </div>
        {(r.predecessorJti || r.successorJti) && (
          <div className="flex items-center gap-1 font-mono text-muted-foreground">
            {r.predecessorJti && <span>{r.predecessorJti}</span>}{r.predecessorJti && <ArrowRight className="size-3" />}
            <span className="text-foreground">{r.jti}</span>
            {r.successorJti && <><ArrowRight className="size-3" /><span>{r.successorJti}</span></>}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-1 border-t pt-2">
        <Button variant="ghost" size="xs" onClick={() => act('validate')}>validate</Button>
        <Button variant="ghost" size="xs" onClick={() => act('touch')}>touch</Button>
        <Button variant="ghost" size="xs" onClick={() => act('update', { metadata: '{ "theme": "dark" }', expectedVersion: '' })}>update</Button>
        <Button variant="ghost" size="xs" onClick={() => act('rotate')}>rotate</Button>
        <Button variant="ghost" size="xs" onClick={() => act('revoke')}>revoke</Button>
        <Button variant="ghost" size="xs" className="text-destructive" onClick={() => act('destroy')}><Trash2 /></Button>
      </CardFooter>
    </Card>
  );
}

function SessionBoard({ mode, lab, onResult, last }: SectionProps) {
  const now = useNow();
  const user = 'user-42';
  const { live, gone } = lab.sim.all(user);
  const sv = lab.sim.securityVersion(user);
  const create = (example: string) => onResult(lab.run('create', spec('session', 'create').examples.find((e) => e.id === example)!.values));
  const cols: Array<{ title: string; status: Status; hint: string }> = [
    { title: 'Active', status: 'active', hint: 'Can authenticate (unless expired or out of date).' },
    { title: 'Consumed', status: 'consumed', hint: 'Replaced by rotation; replay is reported.' },
    { title: 'Revoked', status: 'revoked', hint: 'Logged out; tombstone ≤ 300 s.' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => create('browser')}><LogIn /> Log in on laptop</Button>
        <Button variant="outline" onClick={() => create('phone')}><Smartphone /> Log in on phone</Button>
        <Button variant="outline" onClick={() => create('idle')}>Kiosk (idle 20 s)</Button>
        <Separator orientation="vertical" className="h-6" />
        <Button variant="outline" onClick={() => onResult(lab.run('setSecurityVersion', { userId: user, version: (sv ?? 1) + 1 }))}><ShieldAlert /> Bump security version {sv !== null && `(${sv} → ${sv + 1})`}</Button>
        <Button variant="outline" onClick={() => onResult(lab.run('revokeAll', { userId: user, limit: 200 }))}><RotateCcw /> Revoke all</Button>
        <span className="ml-auto text-xs text-muted-foreground">config: ttl {DEMO_CONFIG.ttl}s · idle {DEMO_CONFIG.idleTimeout}s · touchInterval {DEMO_CONFIG.touchInterval}s</span>
      </div>
      <StateDiagram t={lab.lastTransition} />
      <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        {cols.map((col) => (
          <div key={col.status} className="space-y-2">
            <div><div className="flex items-center gap-2 text-sm font-medium">{col.title}<Badge variant="secondary">{live.filter((r) => r.status === col.status).length}</Badge></div><p className="text-xs text-muted-foreground">{col.hint}</p></div>
            {live.filter((r) => r.status === col.status).map((r) => <SessionCard key={r.jti} r={r} lab={lab} mode={mode} onResult={onResult} now={now} />)}
          </div>
        ))}
        <div className="space-y-2">
          <div><div className="flex items-center gap-2 text-sm font-medium">Gone<Badge variant="secondary">{gone.length}</Badge></div><p className="text-xs text-muted-foreground">Deleted: destroy, revokeAll, or TTL.</p></div>
          {gone.slice(0, 8).map((r, n) => (
            <Card key={`${r.jti}${n}`} size="sm" className="gap-1 opacity-60">
              <CardHeader><CardTitle className="font-mono text-sm">{r.jti}</CardTitle><CardDescription className="text-xs">{r.deviceId} · was {r.status}</CardDescription></CardHeader>
            </Card>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ResultCard r={last} />
        <BrowserCard mode={mode} lab={lab} last={last} />
      </div>
    </div>
  );
}

export const SESSION_VARIANTS = [
  { key: '1', name: 'Operations + browser panel', C: SessionOps },
  { key: '2', name: 'Guided walkthrough', C: SessionWalkthrough },
  { key: '3', name: 'Session board', C: SessionBoard },
];
