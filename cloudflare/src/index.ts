import app from './router';
import type { Env } from './types/env';
import { pollGmail } from './jobs/poll-gmail';
import { runMorningWrapup, runEveningWrapup } from './jobs/wrapups';
import {
  generateDailyMemory,
  generateWeeklyMemory,
  generateMonthlyMemory,
  generateYearlyMemory,
  generateAIPrompts,
} from './jobs/memory';
import { processTimedLabels } from './jobs/timed-labels';
import { processEmail } from './pipeline/processor';
import { runTriage } from './pipeline/triage';
import { getAllActiveUsers } from './db/users';

interface EmailMessage {
  userId: number;
  messageId: string;
}

interface BucketMessage {
  userId: number;
  messageId: string;
  bucket: string;
}

interface BackgroundJob {
  userId: number;
  jobType: string;
}

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    switch (event.cron) {
      // Gmail polling — runs every 15 minutes (configured in wrangler.toml)
      case '*/15 * * * *': {
        ctx.waitUntil(pollGmail(env));
        break;
      }

      // 8 AM — morning wrapup
      case '0 8 * * *': {
        ctx.waitUntil(
          (async () => {
            const users = await getAllActiveUsers(env.DB);
            for (const user of users) {
              try {
                await runMorningWrapup(env, user.id);
              } catch (err) {
                console.error(`scheduled: morning wrapup failed for ${user.email}:`, err);
              }
            }
          })(),
        );
        break;
      }

      // 5 PM — evening wrapup + daily memory
      case '0 17 * * *': {
        ctx.waitUntil(
          (async () => {
            const users = await getAllActiveUsers(env.DB);
            for (const user of users) {
              try {
                await runEveningWrapup(env, user.id);
              } catch (err) {
                console.error(`scheduled: evening wrapup failed for ${user.email}:`, err);
              }
              try {
                await generateDailyMemory(env, user.id);
              } catch (err) {
                console.error(`scheduled: daily memory failed for ${user.email}:`, err);
              }
            }
          })(),
        );
        break;
      }

      // 6 PM Saturday — weekly memory + AI prompt generation
      case '0 18 * * 6': {
        ctx.waitUntil(
          (async () => {
            const users = await getAllActiveUsers(env.DB);
            for (const user of users) {
              try {
                await generateWeeklyMemory(env, user.id);
              } catch (err) {
                console.error(`scheduled: weekly memory failed for ${user.email}:`, err);
                continue;
              }
              try {
                await generateAIPrompts(env, user.id);
              } catch (err) {
                console.error(`scheduled: AI prompts failed for ${user.email}:`, err);
              }
            }
          })(),
        );
        break;
      }

      // 7 PM 1st of month — monthly memory
      case '0 19 1 * *': {
        ctx.waitUntil(
          (async () => {
            const users = await getAllActiveUsers(env.DB);
            for (const user of users) {
              try {
                await generateMonthlyMemory(env, user.id);
              } catch (err) {
                console.error(`scheduled: monthly memory failed for ${user.email}:`, err);
              }
            }
          })(),
        );
        break;
      }

      // 8 PM January 1st — yearly memory
      case '0 20 1 1 *': {
        ctx.waitUntil(
          (async () => {
            const users = await getAllActiveUsers(env.DB);
            for (const user of users) {
              try {
                await generateYearlyMemory(env, user.id);
              } catch (err) {
                console.error(`scheduled: yearly memory failed for ${user.email}:`, err);
              }
            }
          })(),
        );
        break;
      }

      // Every 6 hours — timed label sweep (archive/trash expired emails)
      case '0 */6 * * *': {
        ctx.waitUntil(processTimedLabels(env));
        break;
      }

      default:
        console.log(`scheduled: unknown cron trigger: ${event.cron}`);
    }
  },
  queue: async (batch: MessageBatch, env: Env, _ctx: ExecutionContext) => {
    const queueName = batch.queue;
    for (const msg of batch.messages) {
      try {
        await dispatchQueueMessage(env, queueName, msg.body);
        msg.ack();
      } catch (e) {
        console.error(`queue[${queueName}]: message processing failed:`, e);
        msg.retry();
      }
    }
  },
};

async function dispatchQueueMessage(
  env: Env,
  queueName: string,
  body: unknown,
): Promise<void> {
  switch (queueName) {
    case 'gmail-assistant-processing': {
      // v1 legacy single-stage processor
      const m = body as EmailMessage;
      await processEmail(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-triage': {
      // v2 stage 1
      const m = body as EmailMessage;
      await runTriage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-bucket-newsletter':
    case 'gmail-assistant-bucket-notification':
    case 'gmail-assistant-bucket-human':
    case 'gmail-assistant-bucket-transactional':
    case 'gmail-assistant-bucket-security':
    case 'gmail-assistant-bucket-calendar': {
      // v2 stage 2 — handled in commit 4
      const m = body as BucketMessage;
      console.warn(
        `queue[${queueName}]: bucket processor not yet implemented — ` +
        `holding email ${m.messageId} (bucket ${m.bucket})`,
      );
      throw new Error(`bucket processor for ${queueName} not implemented`);
    }
    case 'gmail-assistant-background-jobs': {
      const job = body as BackgroundJob;
      switch (job.jobType) {
        case 'morning_wrapup': await runMorningWrapup(env, job.userId); return;
        case 'evening_wrapup': await runEveningWrapup(env, job.userId); return;
        case 'daily_memory': await generateDailyMemory(env, job.userId); return;
        case 'weekly_memory':
          await generateWeeklyMemory(env, job.userId);
          await generateAIPrompts(env, job.userId);
          return;
        case 'monthly_memory': await generateMonthlyMemory(env, job.userId); return;
        case 'yearly_memory': await generateYearlyMemory(env, job.userId); return;
        default:
          throw new Error(`unknown background job type: ${job.jobType}`);
      }
    }
    default:
      throw new Error(`unknown queue: ${queueName}`);
  }
}
