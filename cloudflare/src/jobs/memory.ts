import type { Env } from '../types/env';
import type { Email, Label, Memory, MemoryType, AIPromptType, PromptType } from '../types/models';
import type { OpenAIConfig } from '../services/openai';
import { generateMemoryWithReasoning, generateText } from '../services/openai';
import { getEmailsByDateRange, getEmailsWithDirtyFeedback, clearFeedbackDirty } from '../db/emails';
import { createMemory, getMemoriesByType, getMemoriesByDateRange } from '../db/memories';
import { getSystemPrompt, getLatestAIPrompt, createAIPrompt } from '../db/prompts';
import { getUserLabelsWithDetails, getAllLabels } from '../db/labels';

// ---------- helpers ----------

function openaiConfig(env: Env): OpenAIConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  };
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildLabelsSection(labels: Label[]): string {
  if (labels.length === 0) return '';
  const lines = labels.map((label) => {
    let line = `- ${label.name}`;
    if (label.description) {
      line += `: ${label.description}`;
    }
    return line;
  });
  return `\n\nAvailable labels (ONLY reference these exact label names in your learnings):\n${lines.join('\n')}`;
}

function buildLabelsSectionWithReasons(labels: Label[]): string {
  if (labels.length === 0) return '';
  const lines = labels.map((label) => {
    let line = `- **${label.name}**`;
    if (label.description) {
      line += `: ${label.description}`;
    }
    if (label.reasons.length > 0) {
      line += ` (reasons: ${label.reasons.join('; ')})`;
    }
    return line;
  });
  return `\n\nCurrent labels configured in the system:\n${lines.join('\n')}`;
}

// ============================================================================
// Daily Memory
// ============================================================================

export async function generateDailyMemory(env: Env, userId: number): Promise<void> {
  console.log(`memory: generating daily memory for user ${userId}`);
  const now = new Date();

  // Get yesterday's date range
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let rangeStart = startOfDay(yesterday);
  let rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);

  // Get emails processed yesterday
  let emails = await getEmailsByDateRange(env.DB, userId, rangeStart.toISOString(), rangeEnd.toISOString());

  if (emails.length === 0) {
    // Fallback: try last 24 hours (useful for manual triggering)
    console.log(`memory: no emails yesterday for user ${userId}, trying last 24 hours`);
    rangeStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    rangeEnd = now;
    emails = await getEmailsByDateRange(env.DB, userId, rangeStart.toISOString(), rangeEnd.toISOString());
    if (emails.length === 0) {
      console.log(`memory: no emails in last 24h for user ${userId}, will check for dirty feedback`);
    }
  }

  // Also fetch emails with dirty feedback
  let dirtyEmails: Email[] = [];
  try {
    dirtyEmails = await getEmailsWithDirtyFeedback(env.DB, userId);
  } catch (err) {
    console.error(`memory: failed to get dirty feedback emails:`, err);
  }

  // Merge, deduplicate by ID
  const seen = new Set(emails.map((e) => e.id));
  for (const e of dirtyEmails) {
    if (!seen.has(e.id)) {
      emails.push(e);
      seen.add(e.id);
    }
  }

  if (emails.length === 0) {
    console.log(`memory: no emails or dirty feedback for user ${userId}, skipping daily memory`);
    return;
  }

  // Get custom prompt
  let customPrompt = '';
  const prompt = await getSystemPrompt(env.DB, userId, 'daily_review');
  if (prompt) {
    customPrompt = prompt.content;
  }

  // Get label details for context
  let labelDetails: Label[] = [];
  try {
    labelDetails = await getUserLabelsWithDetails(env.DB, userId);
  } catch (err) {
    console.error(`memory: failed to get user labels:`, err);
  }

  // Build labels section
  const labelsSection = buildLabelsSection(labelDetails);

  // System prompt
  let systemPrompt = customPrompt;
  if (!systemPrompt) {
    systemPrompt = `You are an AI assistant creating learnings to improve future email processing decisions. Your goal is NOT to summarize what happened, but to extract insights that will help process emails better tomorrow.

Analyze the emails and their categorizations, then create a memory focused on:

**Key learnings for tomorrow:**
- Specific rules to apply (e.g., "emails from @company.com with 'invoice' should get Urgent label")
- Sender patterns to remember
- Content patterns that indicate specific labels

**What worked well:**
- Categorization decisions that seem correct and should be repeated
- Patterns successfully identified (e.g., "newsletters from X always get archived")
- Sender behaviors correctly recognized

**What to improve:**
- Emails that may have been miscategorized and why
- Patterns that were missed or incorrectly applied
- Better ways to handle similar emails in the future

IMPORTANT: Keep your response CONCISE - aim for around 100 words maximum. Be specific and actionable. Focus only on the most important insights that will directly improve future email processing. Format as concise bullet points.`;
  }

  if (labelsSection) {
    systemPrompt += labelsSection;
  }

  // Build email summaries and collect human feedback separately
  const emailSummaries: string[] = [];
  const humanFeedbackItems: string[] = [];

  for (let i = 0; i < emails.length; i++) {
    if (i >= 50) {
      emailSummaries.push(`... and ${emails.length - 50} more emails`);
      break;
    }
    const email = emails[i];

    let reasoning = '';
    if (email.reasoning) {
      reasoning = ` | AI Reasoning: ${email.reasoning}`;
    }

    emailSummaries.push(
      `- From: ${email.fromAddress} | Subject: ${email.subject} | Slug: ${email.slug} | Labels: ${JSON.stringify(email.labelsApplied)} | Archived: ${email.bypassedInbox} | Keywords: ${JSON.stringify(email.keywords)}${reasoning}`,
    );

    if (email.humanFeedback) {
      humanFeedbackItems.push(
        `- Email from ${email.fromAddress} (Subject: ${email.subject}): ${email.humanFeedback}`,
      );
    }
  }

  let humanFeedbackSection = '';
  if (humanFeedbackItems.length > 0) {
    humanFeedbackSection = `

**IMPORTANT - HUMAN FEEDBACK (PRIORITIZE THESE):**
The human provided explicit feedback on these emails. These instructions are CRITICAL and must be prominently included in your memory:

${humanFeedbackItems.join('\n')}

These human corrections should be given highest priority in your learnings.

`;
  }

  const userPrompt = `Review these ${emails.length} processed emails and extract learnings to improve future email handling:

${emailSummaries.join('\n')}
${humanFeedbackSection}
Focus on creating actionable insights that will help process similar emails better in the future. What patterns should be reinforced? What should be done differently?`;

  const config = openaiConfig(env);
  const result = await generateMemoryWithReasoning(config, systemPrompt, userPrompt);

  await createMemory(env.DB, {
    userId,
    type: 'daily',
    content: result.content,
    reasoning: result.reasoning,
    startDate: rangeStart.toISOString(),
    endDate: rangeEnd.toISOString(),
    createdAt: now.toISOString(),
  });

  // Clear dirty flags
  if (dirtyEmails.length > 0) {
    const dirtyIds = dirtyEmails.map((e) => e.id);
    try {
      await clearFeedbackDirty(env.DB, userId, dirtyIds);
    } catch (err) {
      console.error(`memory: failed to clear feedback dirty flags:`, err);
    }
  }

  console.log(
    `memory: daily memory created for user ${userId} (${emails.length} emails, ${dirtyEmails.length} dirty feedback)`,
  );
}

// ============================================================================
// Weekly Memory
// ============================================================================

export async function generateWeeklyMemory(env: Env, userId: number): Promise<void> {
  console.log(`memory: generating weekly memory for user ${userId}`);
  const now = new Date();

  const endDate = startOfDay(now);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  // Get the most recent weekly memory (to evolve from)
  const previousWeeklyMemories = await getMemoriesByType(env.DB, userId, 'weekly', 1);
  const previousMemory = previousWeeklyMemories.length > 0 ? previousWeeklyMemories[0] : null;

  if (previousMemory) {
    console.log(`memory: found previous weekly memory from ${previousMemory.startDate}, will evolve it`);
  } else {
    console.log(`memory: no previous weekly memory found, will create first one`);
  }

  // Get daily memories since the last weekly memory (or last 7 days)
  const dailyStartDate = previousMemory ? previousMemory.endDate : startDate.toISOString();

  const dailyMemories = await getMemoriesByDateRange(
    env.DB,
    userId,
    'daily',
    dailyStartDate,
    endDate.toISOString(),
  );

  if (dailyMemories.length === 0) {
    console.log(`memory: no new daily memories for user ${userId}, skipping weekly memory`);
    return;
  }

  // Get custom prompt
  let customPrompt = '';
  const prompt = await getSystemPrompt(env.DB, userId, 'weekly_summary');
  if (prompt) {
    customPrompt = prompt.content;
  }

  // Get label details for context
  let labelDetails: Label[] = [];
  try {
    labelDetails = await getAllLabels(env.DB, userId);
  } catch (err) {
    console.error(`memory: failed to get labels for weekly memory context:`, err);
  }

  const result = await consolidateMemories(
    env,
    previousMemory,
    dailyMemories,
    'weekly',
    customPrompt,
    labelDetails,
  );

  await createMemory(env.DB, {
    userId,
    type: 'weekly',
    content: result.content,
    reasoning: result.reasoning,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    createdAt: now.toISOString(),
  });

  console.log(
    `memory: weekly memory ${previousMemory ? 'evolved' : 'created'} for user ${userId} (${dailyMemories.length} daily memories)`,
  );
}

// ============================================================================
// Monthly Memory
// ============================================================================

export async function generateMonthlyMemory(env: Env, userId: number): Promise<void> {
  console.log(`memory: generating monthly memory for user ${userId}`);
  const now = new Date();

  // Last month's date range
  const endDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 1);

  // Get the most recent monthly memory (to evolve from)
  const previousMonthlyMemories = await getMemoriesByType(env.DB, userId, 'monthly', 1);
  const previousMemory = previousMonthlyMemories.length > 0 ? previousMonthlyMemories[0] : null;

  if (previousMemory) {
    console.log(`memory: found previous monthly memory from ${previousMemory.startDate}, will evolve it`);
  } else {
    console.log(`memory: no previous monthly memory found, will create first one`);
  }

  // Get weekly memories since the last monthly memory (or last month)
  const weeklyStartDate = previousMemory ? previousMemory.endDate : startDate.toISOString();

  const weeklyMemories = await getMemoriesByDateRange(
    env.DB,
    userId,
    'weekly',
    weeklyStartDate,
    endDate.toISOString(),
  );

  if (weeklyMemories.length === 0) {
    console.log(`memory: no new weekly memories for user ${userId}, skipping monthly memory`);
    return;
  }

  // Get custom prompt
  let customPrompt = '';
  const prompt = await getSystemPrompt(env.DB, userId, 'monthly_summary');
  if (prompt) {
    customPrompt = prompt.content;
  }

  // Get label details for context
  let labelDetails: Label[] = [];
  try {
    labelDetails = await getAllLabels(env.DB, userId);
  } catch (err) {
    console.error(`memory: failed to get labels for monthly memory context:`, err);
  }

  const result = await consolidateMemories(
    env,
    previousMemory,
    weeklyMemories,
    'monthly',
    customPrompt,
    labelDetails,
  );

  await createMemory(env.DB, {
    userId,
    type: 'monthly',
    content: result.content,
    reasoning: result.reasoning,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    createdAt: now.toISOString(),
  });

  console.log(
    `memory: monthly memory ${previousMemory ? 'evolved' : 'created'} for user ${userId} (${weeklyMemories.length} weekly memories)`,
  );
}

// ============================================================================
// Yearly Memory
// ============================================================================

export async function generateYearlyMemory(env: Env, userId: number): Promise<void> {
  console.log(`memory: generating yearly memory for user ${userId}`);
  const now = new Date();

  // Last year's date range
  const endDate = new Date(now.getFullYear(), 0, 1); // Jan 1 this year
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 1);

  // Get the most recent yearly memory (to evolve from)
  const previousYearlyMemories = await getMemoriesByType(env.DB, userId, 'yearly', 1);
  const previousMemory = previousYearlyMemories.length > 0 ? previousYearlyMemories[0] : null;

  if (previousMemory) {
    console.log(`memory: found previous yearly memory from ${previousMemory.startDate}, will evolve it`);
  } else {
    console.log(`memory: no previous yearly memory found, will create first one`);
  }

  // Get monthly memories since the last yearly memory (or last year)
  const monthlyStartDate = previousMemory ? previousMemory.endDate : startDate.toISOString();

  const monthlyMemories = await getMemoriesByDateRange(
    env.DB,
    userId,
    'monthly',
    monthlyStartDate,
    endDate.toISOString(),
  );

  if (monthlyMemories.length === 0) {
    console.log(`memory: no new monthly memories for user ${userId}, skipping yearly memory`);
    return;
  }

  // Get custom prompt
  let customPrompt = '';
  const prompt = await getSystemPrompt(env.DB, userId, 'yearly_summary');
  if (prompt) {
    customPrompt = prompt.content;
  }

  // Get label details for context
  let labelDetails: Label[] = [];
  try {
    labelDetails = await getAllLabels(env.DB, userId);
  } catch (err) {
    console.error(`memory: failed to get labels for yearly memory context:`, err);
  }

  const result = await consolidateMemories(
    env,
    previousMemory,
    monthlyMemories,
    'yearly',
    customPrompt,
    labelDetails,
  );

  await createMemory(env.DB, {
    userId,
    type: 'yearly',
    content: result.content,
    reasoning: result.reasoning,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    createdAt: now.toISOString(),
  });

  console.log(
    `memory: yearly memory ${previousMemory ? 'evolved' : 'created'} for user ${userId} (${monthlyMemories.length} monthly memories)`,
  );
}

// ============================================================================
// Consolidate Memories (shared by weekly/monthly/yearly)
// ============================================================================

async function consolidateMemories(
  env: Env,
  previousMemory: Memory | null,
  newMemories: Memory[],
  period: string,
  customPrompt: string,
  labelDetails: Label[],
): Promise<{ content: string; reasoning: string }> {
  const labelsSection = buildLabelsSectionWithReasons(labelDetails);

  let systemPrompt = customPrompt;
  if (!systemPrompt) {
    if (previousMemory) {
      // Evolutionary mode: update existing memory
      systemPrompt = `You are an AI assistant evolving a ${period} email processing memory. Your task is to UPDATE the existing memory by incorporating new insights from recent lower-level memories.

DO NOT write a new memory from scratch. Instead:

**Reinforce patterns:**
- Keep and strengthen insights that are still relevant and being validated by new data
- Note when patterns continue or become more pronounced

**Amend differences:**
- Update or refine insights when new data shows changes in patterns
- Add new learnings that weren't in the previous memory
- Remove or de-emphasize insights that are no longer relevant

**Maintain continuity:**
- Build on the existing memory's structure and insights
- Show evolution over time rather than replacement
- Keep the most valuable long-term learnings

**Suggestions for label improvements:**
Review the current labels (listed below) against the patterns you've observed and suggest:
- New labels that would help categorize recurring email types not well covered by existing labels
- Additions or refinements to existing label descriptions that would help the AI make better decisions
- New reasons to add to existing labels based on patterns seen in recent emails
- Labels that appear underused or redundant

IMPORTANT: Keep your response concise - aim for around 400 words maximum. Focus only on the most significant changes and patterns. The goal is an EVOLVED memory that's better than the previous one, not a brand new memory. Format as bullet points.`;
    } else {
      // Initial creation mode
      systemPrompt = `You are an AI assistant creating the first ${period} email processing memory. Review the provided memories and create insights focused on:

1. Identifying overarching patterns and trends
2. Highlighting important behavioral patterns
3. Noting recurring themes
4. Providing strategic insights for email management
5. Suggesting process improvements

**Suggestions for label improvements:**
Review the current labels (listed below) against the patterns observed and suggest:
- New labels that would help categorize recurring email types not well covered by existing labels
- Additions or refinements to existing label descriptions that would help the AI make better decisions
- New reasons to add to existing labels based on patterns seen in the emails
- Labels that appear underused or redundant

IMPORTANT: Keep your response concise - aim for around 800 words maximum. Focus on the most important actionable patterns. Format as bullet points.`;
    }
  }

  if (labelsSection) {
    systemPrompt += labelsSection;
  }

  // Prepare summary of new memories
  const memorySummaries = newMemories.map(
    (mem, i) =>
      `New Memory ${i + 1} (${mem.startDate.slice(0, 10)} to ${mem.endDate.slice(0, 10)}):\n${mem.content}`,
  );

  let userPrompt: string;
  if (previousMemory) {
    // Evolutionary update
    userPrompt = `**CURRENT ${period.toUpperCase()} MEMORY (to be evolved):**
Period: ${previousMemory.startDate.slice(0, 10)} to ${previousMemory.endDate.slice(0, 10)}
${previousMemory.content}

**NEW INSIGHTS FROM RECENT MEMORIES (${newMemories.length} new):**
${memorySummaries.join('\n\n')}

Task: Evolve the current memory by:
1. Reinforcing patterns that continue in the new memories
2. Updating insights where new data shows changes
3. Adding new learnings not present in current memory
4. Removing outdated insights

Output an evolved ${period} memory that builds on the current one.`;
  } else {
    // Initial creation
    userPrompt = `Create the first ${period} memory by consolidating these ${newMemories.length} memories:

${memorySummaries.join('\n\n')}

Provide a concise ${period} summary with key patterns and strategic insights.`;
  }

  const config = openaiConfig(env);
  return generateMemoryWithReasoning(config, systemPrompt, userPrompt);
}

// ============================================================================
// AI Prompt Generation
// ============================================================================

export async function generateAIPrompts(env: Env, userId: number): Promise<void> {
  // Get the most recent weekly memory
  const weeklyMemories = await getMemoriesByType(env.DB, userId, 'weekly', 1);
  if (weeklyMemories.length === 0) {
    console.log(`memory: no weekly memory for user ${userId}, skipping AI prompt generation`);
    return;
  }
  const weeklyMemory = weeklyMemories[0];

  const promptTypes: Array<{ aiType: AIPromptType; userType: PromptType; label: string }> = [
    { aiType: 'email_analyze', userType: 'email_analyze', label: 'email analysis' },
    { aiType: 'email_actions', userType: 'email_actions', label: 'email actions' },
  ];

  let failures = 0;
  for (const pt of promptTypes) {
    try {
      await generateSingleAIPrompt(env, userId, pt.aiType, pt.userType, pt.label, weeklyMemory);
    } catch (err) {
      console.error(`memory: failed to generate AI prompt for ${pt.label} (user ${userId}):`, err);
      failures++;
    }
  }

  if (failures === promptTypes.length) {
    throw new Error('all AI prompt generations failed');
  }
}

async function generateSingleAIPrompt(
  env: Env,
  userId: number,
  aiType: AIPromptType,
  userPromptType: PromptType,
  label: string,
  weeklyMemory: Memory,
): Promise<void> {
  // 1. Get user-written system prompt
  let userPromptContent = '';
  const userPromptObj = await getSystemPrompt(env.DB, userId, userPromptType);
  if (userPromptObj) {
    userPromptContent = userPromptObj.content;
  }

  // 2. Get latest AI-written prompt
  let previousAIContent = '';
  const aiPrompt = await getLatestAIPrompt(env.DB, userId, aiType);
  if (aiPrompt) {
    previousAIContent = aiPrompt.content;
  }

  // 3. Build the meta-prompt
  const systemPrompt = `You are an AI assistant that writes supplementary system prompt instructions for ${label}.

Your job is to write additional instructions that will be APPENDED to the user's system prompt when processing emails. These instructions should encode specific learnings, patterns, exceptions, and refinements discovered from processing emails over time.

Rules:
- NEVER contradict the user's original prompt - your instructions supplement it
- Be specific and actionable (e.g., "Emails from noreply@github.com with 'security alert' in subject should be labeled Urgent")
- Include sender-specific rules, content patterns, and learned exceptions
- Remove outdated rules that no longer apply
- Keep your output concise - aim for 200-500 words of clear, direct instructions
- Write in imperative form as instructions to an AI assistant (e.g., "Label X as Y", "Archive emails from Z")
- Do NOT include explanations of why - just the rules themselves`;

  let userPrompt: string;
  if (previousAIContent) {
    userPrompt = `**USER'S ORIGINAL PROMPT (never modify, your output supplements this):**
${userPromptContent}

**YOUR PREVIOUS VERSION (evolve this):**
${previousAIContent}

**LATEST WEEKLY MEMORY (new learnings to incorporate):**
${weeklyMemory.content}

Write an updated version of the supplementary instructions. Reinforce rules that continue to be relevant, add new rules from the weekly memory, and remove any that are outdated.`;
  } else {
    userPrompt = `**USER'S ORIGINAL PROMPT (never modify, your output supplements this):**
${userPromptContent}

**LATEST WEEKLY MEMORY (learnings to base initial rules on):**
${weeklyMemory.content}

Write the first version of supplementary instructions based on the patterns and learnings from the weekly memory.`;
  }

  // 4. Generate via OpenAI
  const config = openaiConfig(env);
  const content = await generateText(config, systemPrompt, userPrompt);

  // 5. Save new version
  const saved = await createAIPrompt(env.DB, userId, aiType, content);
  console.log(`memory: AI prompt for ${label} generated (user ${userId}, version ${saved.version})`);
}
