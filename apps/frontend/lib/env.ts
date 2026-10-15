// The frontend's environment, validated with zod. Server-side only: next.config.ts and server components read it.
import { z } from 'zod';

const EnvSchema = z.object({
  BACKEND_URL: z.url().default('http://localhost:4000'),
});

export const env = EnvSchema.parse(process.env);
