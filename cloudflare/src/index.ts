import { Hono } from 'hono';
import type { Env } from './types/env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    // TODO: cron handlers
  },
  queue: async (batch: MessageBatch, env: Env, ctx: ExecutionContext) => {
    // TODO: queue consumers
  },
};
