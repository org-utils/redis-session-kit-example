// Config for tests: the defaults (the Docker stacks' ports) plus a throwaway encryption key.
import { randomBytes } from 'node:crypto';
import { type Config, loadConfig } from './config/index.ts';

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'), ...env });
}
