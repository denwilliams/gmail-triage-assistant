import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Email, Label, SystemPrompt } from '../types/models';
import { getEmailsByDateRange } from '../db/emails';
import { getUserLabelsWithDetails, getAllLabels } from '../db/labels';
import { getAllSystemPrompts } from '../db/prompts';
import { extractDomain } from '../db/sender-profiles';
import type { OpenAIConfig } from '../services/openai';
import { runPromptWizard } from '../services/openai';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

const WIZARD_SYSTEM_PROMPT = `You are a setup wizard for an AI email triage assistant. Your goal is to understand the user's email management preferences by asking targeted questions, then generate two tailored system prompts.

You will receive an email summary with statistics about the user's recent emails (senders, domains, slugs, labels, keywords, bypass/notification rates). Use this data to ask personalized, relevant questions.

## Rules
- Ask 3-5 questions per round, 2-3 rounds total before generating prompts.
- Reference actual senders, domains, and patterns from their email data.
- Question types: single_select (radio), multi_select (checkboxes), text (free input).
- Keep options concise and actionable.
- After enough information, set done=true and generate both prompts.

## Question Topics (spread across rounds)
Round 1 - Email priorities & senders:
- Which senders are most important to them
- What types of emails should always stay in inbox
- General archiving philosophy (aggressive vs conservative)

Round 2 - Labels & organization:
- How they want emails categorized
- Any senders/domains that should always get specific labels
- Notification preferences (what warrants an alert)

Round 3 (if needed) - Fine-tuning:
- Edge cases or special rules
- Summary/slug preferences
- Any other preferences

## Prompt Generation
When done=true, generate two prompts:

**email_analyze** - System prompt for Stage 1 (content analysis):
- Instructs AI to generate a snake_case slug categorizing the email
- Extract 3-5 keywords
- Write a single-line summary (max 100 chars)
- Incorporate user preferences about categorization

**email_actions** - System prompt for Stage 2 (action generation):
- Instructs AI to decide: labels to apply, whether to bypass inbox (archive), notification message
- Incorporate user preferences about important senders, archiving rules, notification triggers
- Reference the actual label names and their purposes
- Include user's archiving philosophy and notification preferences

When done=false, set prompts to empty strings. When done=true, set questions to an empty array.`;

interface WizardHistoryEntry {
  question_id: string;
  question: string;
  answer: string;
}

interface KVPair {
  key: string;
  count: number;
}

function sortedTopN(m: Map<string, number>, n: number): KVPair[] {
  const pairs = Array.from(m.entries()).map(([key, count]) => ({ key, count }));
  pairs.sort((a, b) => b.count - a.count);
  return pairs.slice(0, n);
}

function buildWizardEmailSummary(emails: Email[], labels: Label[], prompts: SystemPrompt[]): string {
  const totalEmails = emails.length;
  if (totalEmails === 0) {
    return 'No emails found in the last 2 weeks.\n';
  }

  const lines: string[] = [];

  // Volume
  const days = 14;
  const dailyAvg = totalEmails / days;
  lines.push(`## Volume\nTotal: ${totalEmails} emails over 14 days (${dailyAvg.toFixed(1)}/day avg)\n`);

  // Count senders, domains, slugs, labels, keywords, bypass, notifications
  const senderCounts = new Map<string, number>();
  const senderArchived = new Map<string, number>();
  const senderLabels = new Map<string, Set<string>>();
  const domainCounts = new Map<string, number>();
  const domainArchived = new Map<string, number>();
  const slugCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();
  let bypassed = 0;
  let notified = 0;

  for (const e of emails) {
    senderCounts.set(e.fromAddress, (senderCounts.get(e.fromAddress) ?? 0) + 1);
    if (e.bypassedInbox) {
      senderArchived.set(e.fromAddress, (senderArchived.get(e.fromAddress) ?? 0) + 1);
      bypassed++;
    }
    if (e.notificationSent) {
      notified++;
    }

    const domain = extractDomain(e.fromAddress);
    if (domain) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      if (e.bypassedInbox) {
        domainArchived.set(domain, (domainArchived.get(domain) ?? 0) + 1);
      }
    }

    if (e.slug) {
      slugCounts.set(e.slug, (slugCounts.get(e.slug) ?? 0) + 1);
    }
    for (const l of e.labelsApplied) {
      labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
    }
    for (const kw of e.keywords) {
      keywordCounts.set(kw, (keywordCounts.get(kw) ?? 0) + 1);
    }

    if (!senderLabels.has(e.fromAddress)) {
      senderLabels.set(e.fromAddress, new Set());
    }
    for (const l of e.labelsApplied) {
      senderLabels.get(e.fromAddress)!.add(l);
    }
  }

  // Top 15 senders
  const topSenders = sortedTopN(senderCounts, 15);
  lines.push('## Top Senders');
  for (const s of topSenders) {
    const archiveRate = ((senderArchived.get(s.key) ?? 0) / s.count) * 100;
    const lbls = Array.from(senderLabels.get(s.key) ?? []).sort();
    const lblStr = lbls.length > 0 ? ` [labels: ${lbls.join(', ')}]` : '';
    lines.push(`- ${s.key}: ${s.count} emails, ${Math.round(archiveRate)}% archived${lblStr}`);
  }
  lines.push('');

  // Top 10 domains
  const topDomains = sortedTopN(domainCounts, 10);
  lines.push('## Top Domains');
  for (const d of topDomains) {
    const archiveRate = ((domainArchived.get(d.key) ?? 0) / d.count) * 100;
    lines.push(`- ${d.key}: ${d.count} emails, ${Math.round(archiveRate)}% archived`);
  }
  lines.push('');

  // Top 15 slugs
  const topSlugs = sortedTopN(slugCounts, 15);
  lines.push('## Top Email Categories (slugs)');
  for (const s of topSlugs) {
    lines.push(`- ${s.key}: ${s.count}`);
  }
  lines.push('');

  // Label distribution
  const topLabelsArr = sortedTopN(labelCounts, 20);
  lines.push('## Label Distribution');
  for (const l of topLabelsArr) {
    lines.push(`- ${l.key}: ${l.count}`);
  }
  lines.push('');

  // Top 20 keywords
  const topKeywords = sortedTopN(keywordCounts, 20);
  lines.push('## Top Keywords');
  for (const k of topKeywords) {
    lines.push(`- ${k.key}: ${k.count}`);
  }
  lines.push('');

  // Rates
  const bypassRate = (bypassed / totalEmails) * 100;
  const notifRate = (notified / totalEmails) * 100;
  lines.push(`## Rates\nBypass inbox: ${bypassRate.toFixed(1)}%\nNotification: ${notifRate.toFixed(1)}%\n`);

  // Label configs with reasons
  if (labels.length > 0) {
    lines.push('## Configured Labels');
    for (const l of labels) {
      let line = `- ${l.name}`;
      if (l.description) {
        line += `: ${l.description}`;
      }
      if (l.reasons.length > 0) {
        line += ` (reasons: ${l.reasons.join('; ')})`;
      }
      lines.push(line);
    }
    lines.push('');
  }

  // Existing prompts summary
  for (const p of prompts) {
    if (p.type === 'email_analyze' || p.type === 'email_actions') {
      let content = p.content;
      if (content.length > 200) {
        content = content.slice(0, 200) + '...';
      }
      lines.push(`## Current ${p.type} prompt (preview)\n${content}\n`);
    }
  }

  return lines.join('\n');
}

function buildWizardConversationPrompt(emailSummary: string, history: WizardHistoryEntry[]): string {
  const lines: string[] = [];
  lines.push('Here is my email data from the last 2 weeks:\n');
  lines.push(emailSummary);
  lines.push('\n## Our conversation so far:\n');

  for (const h of history) {
    lines.push(`Q (${h.question_id}): ${h.question}\nA: ${h.answer}\n`);
  }

  lines.push(
    'Based on my answers, please continue with the next round of questions, or if you have enough information, generate the final prompts.',
  );

  return lines.join('\n');
}

function getOpenAIConfig(env: Env): OpenAIConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  };
}

export async function handlePromptWizardStart(c: AppContext) {
  const userId = c.get('userId');

  try {
    // Fetch 2 weeks of emails
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const emails = await getEmailsByDateRange(
      c.env.DB,
      userId,
      twoWeeksAgo.toISOString(),
      now.toISOString(),
    );

    // Fetch labels
    const labels = await getUserLabelsWithDetails(c.env.DB, userId);

    // Fetch existing prompts
    const prompts = await getAllSystemPrompts(c.env.DB, userId);

    const emailSummary = buildWizardEmailSummary(emails, labels, prompts);

    const userPrompt = `Here is my email data from the last 2 weeks:\n\n${emailSummary}\n\nPlease start the setup wizard by asking your first round of questions.`;

    const config = getOpenAIConfig(c.env);
    const result = await runPromptWizard(config, WIZARD_SYSTEM_PROMPT, userPrompt);

    return c.json({
      done: result.done,
      message: result.message,
      questions: result.questions,
      prompts: result.prompts,
      email_summary: emailSummary,
    });
  } catch (e) {
    console.error('Wizard AI call failed:', e);
    return c.json({ error: 'AI wizard failed' }, 500);
  }
}

export async function handlePromptWizardContinue(c: AppContext) {
  const body = await c.req
    .json<{ email_summary?: string; history?: WizardHistoryEntry[] }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.email_summary) {
    return c.json({ error: 'email_summary is required' }, 400);
  }

  try {
    const userPrompt = buildWizardConversationPrompt(body.email_summary, body.history ?? []);

    const config = getOpenAIConfig(c.env);
    const result = await runPromptWizard(config, WIZARD_SYSTEM_PROMPT, userPrompt);

    return c.json({
      done: result.done,
      message: result.message,
      questions: result.questions,
      prompts: result.prompts,
    });
  } catch (e) {
    console.error('Wizard AI continue call failed:', e);
    return c.json({ error: 'AI wizard failed' }, 500);
  }
}
