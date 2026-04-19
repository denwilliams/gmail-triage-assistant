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
import { runDailyDigest } from './jobs/daily-digest';
import { runSenderRatingSweep } from './jobs/sender-rating';
import { processEmail } from './pipeline/processor';
import { runTriage } from './pipeline/triage';
import { processNewsletterMessage } from './pipeline/buckets/newsletter';
import { processNotificationMessage } from './pipeline/buckets/notification';
import { processHumanMessage } from './pipeline/buckets/human';
import { processTransactionalMessage } from './pipeline/buckets/transactional';
import { processSecurityMessage } from './pipeline/buckets/security';
import { processCalendarMessage } from './pipeline/buckets/calendar';
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
      // Gmail polling — every 15 minutes (UTC; timezone doesn't matter).
      case '*/15 * * * *': {
        ctx.waitUntil(pollGmail(env));
        break;
      }

      // Hourly dispatcher — computes local time from TIMEZONE and fires
      // whichever daily/weekly/monthly/yearly jobs are due this hour. See
      // runHourlyDispatch below.
      case '0 * * * *': {
        ctx.waitUntil(runHourlyDispatch(env));
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
    case 'gmail-assistant-bucket-newsletter': {
      const m = body as BucketMessage;
      await processNewsletterMessage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-bucket-notification': {
      const m = body as BucketMessage;
      await processNotificationMessage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-bucket-human': {
      const m = body as BucketMessage;
      await processHumanMessage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-bucket-transactional': {
      const m = body as BucketMessage;
      await processTransactionalMessage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-bucket-security': {
      const m = body as BucketMessage;
      await processSecurityMessage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-bucket-calendar': {
      const m = body as BucketMessage;
      await processCalendarMessage(env, m.userId, m.messageId);
      return;
    }
    case 'gmail-assistant-background-jobs': {
      const job = body as BackgroundJob;
      switch (job.jobType) {
        case 'morning_wrapup': await runMorningWrapup(env, job.userId); return;
        case 'evening_wrapup': await runEveningWrapup(env, job.userId); return;
        case 'daily_digest': await runDailyDigest(env, job.userId); return;
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

// ============================================================================
// Hourly cron dispatcher
// ----------------------------------------------------------------------------
// Cloudflare delivers crons in UTC, but users want wrapups/digests at local
// time (and want daylight-savings transitions to "just work"). We run a single
// `0 * * * *` cron hourly and look at the local hour/day/month derived from
// the TIMEZONE env var to decide which daily/weekly/monthly/yearly jobs are
// due. Most hours are no-ops.
// ============================================================================

interface LocalTime {
  hour: number;      // 0-23
  weekday: number;   // 0=Sun .. 6=Sat
  dayOfMonth: number;
  month: number;     // 1-12
}

function localTime(tz: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  let hour = parseInt(get('hour'), 10);
  if (Number.isNaN(hour)) hour = 0;
  // Some ICU locales return "24" for midnight — normalise.
  if (hour === 24) hour = 0;

  return {
    hour,
    weekday: weekdayMap[get('weekday')] ?? 0,
    dayOfMonth: parseInt(get('day'), 10) || 1,
    month: parseInt(get('month'), 10) || 1,
  };
}

async function runHourlyDispatch(env: Env): Promise<void> {
  const tz = env.TIMEZONE || 'UTC';
  const { hour, weekday, dayOfMonth, month } = localTime(tz);
  console.log(`hourly-dispatch: tz=${tz} hour=${hour} weekday=${weekday} date=${month}/${dayOfMonth}`);

  // Timed labels: every 6 hours (local) at :00.
  if (hour % 6 === 0) {
    try {
      await processTimedLabels(env);
    } catch (err) {
      console.error('hourly-dispatch: timed labels failed:', err);
    }
  }

  // 3 AM local: sender rating sweep (v2 only; sweep itself filters users).
  if (hour === 3) {
    try {
      await runSenderRatingSweep(env);
    } catch (err) {
      console.error('hourly-dispatch: sender rating sweep failed:', err);
    }
  }

  // Per-user jobs — loop once and fire anything due this hour.
  const users = await getAllActiveUsers(env.DB);

  for (const user of users) {
    // 8 AM local: morning wrapup + daily digest (v2).
    if (hour === 8) {
      try {
        await runMorningWrapup(env, user.id);
      } catch (err) {
        console.error(`hourly-dispatch: morning wrapup failed for ${user.email}:`, err);
      }
      if (user.pipelineVersion === 'v2') {
        try {
          await runDailyDigest(env, user.id);
        } catch (err) {
          console.error(`hourly-dispatch: daily digest failed for ${user.email}:`, err);
        }
      }
    }

    // 5 PM local: evening wrapup + daily memory.
    if (hour === 17) {
      try {
        await runEveningWrapup(env, user.id);
      } catch (err) {
        console.error(`hourly-dispatch: evening wrapup failed for ${user.email}:`, err);
      }
      try {
        await generateDailyMemory(env, user.id);
      } catch (err) {
        console.error(`hourly-dispatch: daily memory failed for ${user.email}:`, err);
      }
    }

    // 6 PM Saturday local: weekly memory + AI prompt generation.
    if (hour === 18 && weekday === 6) {
      try {
        await generateWeeklyMemory(env, user.id);
        await generateAIPrompts(env, user.id);
      } catch (err) {
        console.error(`hourly-dispatch: weekly memory failed for ${user.email}:`, err);
      }
    }

    // 7 PM on the 1st of the month local: monthly memory.
    if (hour === 19 && dayOfMonth === 1) {
      try {
        await generateMonthlyMemory(env, user.id);
      } catch (err) {
        console.error(`hourly-dispatch: monthly memory failed for ${user.email}:`, err);
      }
    }

    // 8 PM on January 1st local: yearly memory.
    if (hour === 20 && dayOfMonth === 1 && month === 1) {
      try {
        await generateYearlyMemory(env, user.id);
      } catch (err) {
        console.error(`hourly-dispatch: yearly memory failed for ${user.email}:`, err);
      }
    }
  }
}
