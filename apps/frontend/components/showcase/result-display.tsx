// Small compositions of shadcn primitives for showing results and Redis state (no layout here).
'use client';

import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Mode } from '@showcase/contracts';
import type { KeyTouched, RunResult } from '@/lib/showcase/api';
import { modeText } from '@/lib/showcase/mock-backend';
import { REDIS_INSIGHT, healthDot, redisCli, type Health } from '@/lib/showcase/live';

export function HttpBadge({ code }: { code: number }) {
  if (code === 0) return <Badge variant="outline" className="font-mono">not sent</Badge>;
  if (code >= 500) return <Badge variant="destructive" className="font-mono">{code}</Badge>;
  if (code >= 400) return <Badge className="bg-warning font-mono text-warning-foreground">{code}</Badge>;
  return <Badge className="bg-success font-mono text-success-foreground">{code}</Badge>;
}

export function HealthDot({ health }: { health: Health }) {
  return <span aria-label={health} className={cn('inline-block size-2 shrink-0 rounded-full', healthDot[health])} />;
}

export function ModeName({ mode, className }: { mode: Mode; className?: string }) {
  return <span className={cn('font-medium', modeText[mode], className)}>{mode}</span>;
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-code p-3 font-mono text-xs leading-relaxed text-code-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function KeysTable({ keys, mode }: { keys: KeyTouched[]; mode: Mode }) {
  if (!keys.length) return <p className="text-xs text-muted-foreground">No keys touched.</p>;
  return (
    <Table className="font-mono text-xs">
      <TableHeader>
        <TableRow>
          <TableHead>key</TableHead>
          <TableHead>type</TableHead>
          <TableHead>ttl</TableHead>
          {mode === 'cluster' && <TableHead>slot → node</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k.key}>
            <TableCell className="max-w-56 whitespace-normal break-all text-code-key">{k.key}</TableCell>
            <TableCell>{k.type}</TableCell>
            <TableCell>{k.type === 'none' ? 'gone' : k.ttl ?? '∞'}</TableCell>
            {mode === 'cluster' && <TableCell className="text-code-slot">{k.slot} → {k.node?.split(':')[1]}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function InsightLink({ mode }: { mode: Mode }) {
  return (
    <Button variant="link" size="xs" className="h-auto px-0" asChild>
      <a href={REDIS_INSIGHT[mode]} target="_blank" rel="noreferrer">
        RedisInsight · {mode} <ExternalLink />
      </a>
    </Button>
  );
}

export function Commands({ r }: { r: RunResult }) {
  return (
    <ul className="space-y-0.5 rounded-md bg-code p-3 font-mono text-xs text-code-foreground">
      {r.commands.length ? r.commands.map((c, i) => <li key={i} className="break-all">› {c}</li>) : <li className="text-muted-foreground">none</li>}
      {!!r.omitted?.commands && <li className="text-muted-foreground">… and {r.omitted.commands} more</li>}
    </ul>
  );
}

/** The command to look at it yourself: the first touched key that still exists, or just the redis-cli prompt. */
export function CliSnippet({ mode, keys = [], master }: { mode: Mode; keys?: KeyTouched[]; master?: string }) {
  return <code className="block break-all rounded-md bg-code p-2 font-mono text-[11px] text-code-foreground">{redisCli(mode, keys.find((k) => k.type !== 'none'), master)}</code>;
}
