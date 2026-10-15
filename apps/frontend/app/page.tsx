import { connection } from 'next/server';
import { Suspense } from 'react';
import { ShowcaseShell } from '@/components/showcase/showcase-shell';
import { fetchStatus } from '@/lib/showcase/status';

export default async function Home() {
  await connection(); // the status is per request, never prerendered
  const initialStatus = await fetchStatus();
  return (
    <Suspense>
      <ShowcaseShell initialStatus={initialStatus} />
    </Suspense>
  );
}
