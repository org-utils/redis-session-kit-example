// Operation tabs over the request form, for sections that run their operations against their own live state
// (lock, rate limit, pub/sub, streams). The section decides what Run does; the result shows under the form. Run stays
// enabled while a request is open, so a long one (lock.using) can be raced from the other lane.
'use client';

import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import type { Mode } from '@showcase/contracts';
import { RequestForm, type TokenOption } from './request-form';
import { HttpBadge, Json } from './result-display';

export function OpForm({ module, ops, mode, tokens, onRun, onResult }: {
  module: string; ops: string[]; mode: Mode; tokens?: TokenOption[];
  onRun: (op: string, values: Values) => Promise<RunResult>;
  /** Every finished run, for the Redis-state panel. */
  onResult?: (r: RunResult) => void;
}) {
  const [op, setOp] = useState(ops[0]);
  const s = spec(module, op);
  const [exampleId, setExampleId] = useState<string | null>(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  const [result, setResult] = useState<RunResult | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const pickOp = (o: string) => {
    const first = spec(module, o).examples[0];
    setOp(o); setExampleId(first.id); setValues(first.values); setResult(null);
  };
  const run = async () => {
    setInFlight((n) => n + 1);
    try {
      const r = await onRun(op, values);
      setResult(r);
      onResult?.(r);
    } finally {
      setInFlight((n) => n - 1);
    }
  };
  return (
    <div className="space-y-4">
      <Tabs value={op} onValueChange={pickOp}>
        <TabsList variant="line">{ops.map((o) => <TabsTrigger key={o} value={o} className="font-mono">{o}</TabsTrigger>)}</TabsList>
      </Tabs>
      <RequestForm spec={s} values={values} modified={modified} onChange={setValues} tokens={tokens}
        selected={modified ? null : exampleId} onPick={(e) => { setExampleId(e.id); setValues(e.values); }}
        onReset={() => example && setValues(example.values)}
        footer={<>
          <Button onClick={run}><Play /> Run on {mode}</Button>
          {inFlight > 0 && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {inFlight} running</span>}
        </>} />
      {result && (
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-mono text-sm">{result.op}()</CardTitle>
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">{result.latencyMs}ms <HttpBadge code={result.httpStatus} /></div>
          </CardHeader>
          <CardContent><Json value={result.body} /></CardContent>
        </Card>
      )}
    </div>
  );
}
