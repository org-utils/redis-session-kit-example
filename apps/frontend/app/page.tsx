import { Suspense } from 'react';
import { ShowcaseShell } from '@/components/showcase/showcase-shell';

export default function Home() {
  return (
    <Suspense>
      <ShowcaseShell />
    </Suspense>
  );
}
