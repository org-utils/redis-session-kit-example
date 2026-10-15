// Operation tabs over the request form, for sections that run their operations against their own live state
// (lock, rate limit, pub/sub, streams). The section decides what Run does; the result shows under the form.
'use client';

import { Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { spec, type Values } from '@/lib/showcase/examples';
import type { Mode } from '@/lib/showcase/mock-backend';
import { RequestForm, type TokenOption } from './request-form';
import { Json } from './result-display';

export function OpForm({ module, ops, mode, tokens, onRun }: {
  module: string; ops: string[]; mode: Mode; tokens?: TokenOption[]; onRun: (op: string, values: Values) => unknown;
}) {
  const [op, setOp] = useState(ops[0]);
  const s = spec(module, op);
  const [exampleId, setExampleId] = useState<string | null>(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  const [result, setResult] = useState<{ op: string; body: unknown } | null>(null);
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const pickOp = (o: string) => {
    const first = spec(module, o).examples[0];
    setOp(o); setExampleId(first.id); setValues(first.values); setResult(null);
  };
  return (
    <div className="space-y-4">
      <Tabs value={op} onValueChange={pickOp}>
        <TabsList variant="line">{ops.map((o) => <TabsTrigger key={o} value={o} className="font-mono">{o}</TabsTrigger>)}</TabsList>
      </Tabs>
      <RequestForm spec={s} values={values} modified={modified} onChange={setValues} tokens={tokens}
        selected={modified ? null : exampleId} onPick={(e) => { setExampleId(e.id); setValues(e.values); }}
        onReset={() => example && setValues(example.values)}
        footer={<Button onClick={() => setResult({ op, body: onRun(op, values) })}><Play /> Run on {mode}</Button>} />
      {result && (
        <Card size="sm">
          <CardHeader><CardTitle className="font-mono text-sm">{result.op}()</CardTitle></CardHeader>
          <CardContent><Json value={result.body} /></CardContent>
        </Card>
      )}
    </div>
  );
}
