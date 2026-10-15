// PROTOTYPE: the showcase UI shell. Variant A won; variants B and C live in this branch's history
// (commit 8cfa30b). All data is stubbed in memory (see stub.ts and examples.ts); nothing talks to a backend.
'use client';

import { Suspense } from 'react';
import { VariantA } from './variant-a';

export default function UiShellPrototype() {
  return (
    <Suspense>
      <VariantA />
    </Suspense>
  );
}
