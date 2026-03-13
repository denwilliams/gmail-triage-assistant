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
import { processEmail } from './pipeline/processor';
import { getAllActiveUsers } from './db/users';

interface EmailMessage {
  userId: number;
  messageId: string;
}

interface BackgroundJob {
  userId: number;
  jobType: string;
}

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    switch (event.cron) {
      // Gmail polling — runs every 5 minutes (configured in wrangler.toml)
      case '*/5 * * * *': {
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

      default:
        console.log(`scheduled: unknown cron trigger: ${event.cron}`);
    }
  },
  queue: async (batch: MessageBatch, env: Env, ctx: ExecutionContext) => {
    for (const msg of batch.messages) {
      try {
        const body = msg.body as EmailMessage | BackgroundJob;
        if ('messageId' in body) {
          // email-processing queue
          await processEmail(env, body.userId, body.messageId);
        } else if ('jobType' in body) {
          // background-jobs queue
          switch (body.jobType) {
            case 'morning_wrapup':
              await runMorningWrapup(env, body.userId);
              break;
            case 'evening_wrapup':
              await runEveningWrapup(env, body.userId);
              break;
            case 'daily_memory':
              await generateDailyMemory(env, body.userId);
              break;
            case 'weekly_memory':
              await generateWeeklyMemory(env, body.userId);
              await generateAIPrompts(env, body.userId);
              break;
            case 'monthly_memory':
              await generateMonthlyMemory(env, body.userId);
              break;
            case 'yearly_memory':
              await generateYearlyMemory(env, body.userId);
              break;
            default:
              console.error(`queue: unknown job type: ${body.jobType}`);
          }
        }
        msg.ack();
      } catch (e) {
        console.error('queue: message processing failed:', e);
        msg.retry();
      }
    }
  },
};
