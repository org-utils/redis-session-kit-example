// The session section: every session operation with editable examples, this browser's cookie and token wallet,
// and a live table of the user's sessions on the selected connection mode.
'use client';

import { Cookie, Play, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { spec, type Values } from '@/lib/showcase/examples';
import type { Mode, RunResult } from '@/lib/showcase/mock-backend';
import type { Status, useSessionLab } from '@/lib/showcase/mock-sessions';
import { RequestForm, type TokenOption } from './request-form';
import { HttpBadge, Json } from './result-display';

type Lab = ReturnType<typeof useSessionLab>;
interface SectionProps { mode: Mode; lab: Lab; onResult: (r: RunResult) => void; last: RunResult | null }

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

const OPS = ['create', 'validate', 'get', 'touch', 'update', 'rotate', 'revoke', 'destroy', 'setSecurityVersion', 'revokeAll', 'list'];

export function SessionSection({ mode, lab, onResult, last }: SectionProps) {
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
