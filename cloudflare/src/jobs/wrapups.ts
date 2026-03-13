import type { Env } from '../types/env';
import type { Email } from '../types/models';
import type { OpenAIConfig } from '../services/openai';
import { getEmailsByDateRange } from '../db/emails';
import { createWrapupReport } from '../db/wrapups';
import { getSystemPrompt } from '../db/prompts';
import { generateText } from '../services/openai';

// ---------- public API ----------

export async function runMorningWrapup(env: Env, userId: number): Promise<void> {
  const now = new Date();
  // Get emails since 5 PM yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const since = new Date(yesterday);
  since.setHours(17, 0, 0, 0);

  const emails = await getEmailsByDateRange(env.DB, userId, since.toISOString(), now.toISOString());
  if (emails.length === 0) {
    console.log(`wrapups: no emails since yesterday evening for user ${userId}, skipping morning wrapup`);
    return;
  }

  const content = await generateWrapupContent(env, userId, emails, 'morning');

  await createWrapupReport(env.DB, {
    userId,
    reportType: 'morning',
    content,
    emailCount: emails.length,
    generatedAt: now.toISOString(),
  });

  console.log(`wrapups: morning wrapup saved for user ${userId} (${emails.length} emails)`);
}

export async function runEveningWrapup(env: Env, userId: number): Promise<void> {
  const now = new Date();
  // Get emails since 8 AM today
  const since = new Date(now);
  since.setHours(8, 0, 0, 0);

  const emails = await getEmailsByDateRange(env.DB, userId, since.toISOString(), now.toISOString());
  if (emails.length === 0) {
    console.log(`wrapups: no emails since this morning for user ${userId}, skipping evening wrapup`);
    return;
  }

  const content = await generateWrapupContent(env, userId, emails, 'evening');

  await createWrapupReport(env.DB, {
    userId,
    reportType: 'evening',
    content,
    emailCount: emails.length,
    generatedAt: now.toISOString(),
  });

  console.log(`wrapups: evening wrapup saved for user ${userId} (${emails.length} emails)`);
}

// ---------- internals ----------

function openaiConfig(env: Env): OpenAIConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  };
}

async function generateWrapupContent(
  env: Env,
  userId: number,
  emails: Email[],
  reportType: 'morning' | 'evening',
): Promise<string> {
  const stats = buildWrapupStats(emails, reportType);
  const aiSummary = await generateAISummary(env, userId, emails, reportType);

  if (aiSummary) {
    return 'Summary\n' + aiSummary + '\n\n' + stats;
  }
  return stats;
}

// ---------- stats ----------

interface Ranked {
  name: string;
  count: number;
}

function topN(counts: Record<string, number>, n: number): Ranked[] {
  const items = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  return items.slice(0, n);
}

function writeTable(items: Ranked[]): string {
  let maxName = 0;
  for (const item of items) {
    if (item.name.length > maxName) maxName = item.name.length;
  }
  return items.map((item) => `${item.name.padEnd(maxName)}    ${item.count}`).join('\n') + '\n';
}

function buildWrapupStats(emails: Email[], reportType: 'morning' | 'evening'): string {
  const now = new Date();
  const total = emails.length;
  const title = reportType === 'morning' ? 'Morning Wrapup' : 'Evening Wrapup';

  // Count inbox vs archived
  let inboxCount = 0;
  let archivedCount = 0;
  for (const e of emails) {
    if (e.bypassedInbox) {
      archivedCount++;
    } else {
      inboxCount++;
    }
  }

  // Top senders
  const senderCounts: Record<string, number> = {};
  for (const e of emails) {
    senderCounts[e.fromAddress] = (senderCounts[e.fromAddress] || 0) + 1;
  }
  const topSenders = topN(senderCounts, 5);

  // Labels
  const labelCounts: Record<string, number> = {};
  for (const e of emails) {
    for (const l of e.labelsApplied) {
      labelCounts[l] = (labelCounts[l] || 0) + 1;
    }
  }
  const topLabels = topN(labelCounts, 5);

  // Common types (slugs)
  const slugCounts: Record<string, number> = {};
  for (const e of emails) {
    if (e.slug) {
      slugCounts[e.slug] = (slugCounts[e.slug] || 0) + 1;
    }
  }
  const topSlugs = topN(slugCounts, 5);

  // Build output
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const header = `${title} — ${dateStr} (${total} emails)`;
  const divider = '═'.repeat(header.length);

  let out = `${divider}\n${header}\n${divider}\n`;
  out += `\nOverview\nInbox: ${inboxCount}  |  Archived: ${archivedCount}\n`;

  if (topSenders.length > 0) {
    out += '\nTop Senders\n' + writeTable(topSenders);
  }

  if (topLabels.length > 0) {
    out += '\nLabels\n' + writeTable(topLabels);
  }

  if (topSlugs.length > 0) {
    out += '\nCommon Types\n' + writeTable(topSlugs);
  }

  return out;
}

// ---------- AI summary ----------

async function generateAISummary(
  env: Env,
  userId: number,
  emails: Email[],
  reportType: 'morning' | 'evening',
): Promise<string> {
  try {
    // Try to get custom prompt
    let systemPrompt = '';
    const customPrompt = await getSystemPrompt(env.DB, userId, 'wrapup_report');
    if (customPrompt) {
      systemPrompt = customPrompt.content;
    }
    if (!systemPrompt) {
      systemPrompt =
        'You are an assistant summarizing a batch of processed emails. In 1-2 sentences, highlight the most notable themes or important items the user should be aware of. Be specific and actionable.';
    }

    // Build compact email list (limit to 100)
    const lines: string[] = [];
    for (let i = 0; i < emails.length; i++) {
      if (i >= 100) {
        lines.push(`... and ${emails.length - 100} more emails`);
        break;
      }
      const email = emails[i];
      const archived = email.bypassedInbox ? ' [archived]' : '';
      lines.push(
        `- ${email.fromAddress}: ${email.subject} (labels: ${email.labelsApplied.join(', ')})${archived}`,
      );
    }

    const timeframe = reportType === 'evening' ? 'today' : 'overnight';
    const userPrompt = `Here are ${emails.length} emails processed ${timeframe}. Summarize the most notable themes or items in 1-2 sentences:\n\n${lines.join('\n')}`;

    const config = openaiConfig(env);
    const content = await generateText(config, systemPrompt, userPrompt);
    return content.trim();
  } catch (err) {
    console.error('wrapups: AI summary generation failed, omitting summary section:', err);
    return '';
  }
}
