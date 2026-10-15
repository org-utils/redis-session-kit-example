// Gives the backend a session encryption key: appends a random 32-byte base64 SESSION_ENCRYPTION_KEY to
// apps/backend/.env if it has none, creating the file. Runs before `pnpm dev` and `pnpm dev:apps`; a no-op once set.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const envFile = join(import.meta.dirname, '..', 'apps', 'backend', '.env');
const current = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';

if (!/^SESSION_ENCRYPTION_KEY=\S/m.test(current)) {
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(envFile, `${separator}SESSION_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`);
  console.log(`Generated SESSION_ENCRYPTION_KEY in ${relative(process.cwd(), envFile)}`);
}
