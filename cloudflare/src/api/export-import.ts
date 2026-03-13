import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { ExportEnvelope, ImportResult } from '../types/models';
import { exportAllData, importAllData } from '../db/export-import';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function envelopeToJSON(envelope: ExportEnvelope) {
  return {
    version: envelope.version,
    exported_at: envelope.exportedAt,
    app: envelope.app,
    include_emails: envelope.includeEmails,
    data: {
      labels: envelope.data.labels,
      system_prompts: envelope.data.systemPrompts.map((p) => ({
        type: p.type,
        content: p.content,
      })),
      ai_prompts: envelope.data.aiPrompts.map((p) => ({
        type: p.type,
        content: p.content,
        version: p.version,
        created_at: p.createdAt,
      })),
      memories: envelope.data.memories.map((m) => ({
        type: m.type,
        content: m.content,
        reasoning: m.reasoning,
        start_date: m.startDate,
        end_date: m.endDate,
        created_at: m.createdAt,
      })),
      sender_profiles: envelope.data.senderProfiles.map((p) => ({
        profile_type: p.profileType,
        identifier: p.identifier,
        email_count: p.emailCount,
        emails_archived: p.emailsArchived,
        emails_notified: p.emailsNotified,
        slug_counts: p.slugCounts,
        label_counts: p.labelCounts,
        keyword_counts: p.keywordCounts,
        sender_type: p.senderType,
        summary: p.summary,
        first_seen_at: p.firstSeenAt,
        last_seen_at: p.lastSeenAt,
      })),
      wrapup_reports: envelope.data.wrapupReports.map((r) => ({
        report_type: r.reportType,
        content: r.content,
        email_count: r.emailCount,
        generated_at: r.generatedAt,
      })),
      notifications: envelope.data.notifications.map((n) => ({
        email_id: n.emailId,
        from_address: n.fromAddress,
        subject: n.subject,
        message: n.message,
        sent_at: n.sentAt,
      })),
      emails: envelope.data.emails?.map((e) => ({
        id: e.id,
        from_address: e.fromAddress,
        from_domain: e.fromDomain,
        subject: e.subject,
        slug: e.slug,
        keywords: e.keywords,
        summary: e.summary,
        labels_applied: e.labelsApplied,
        bypassed_inbox: e.bypassedInbox,
        reasoning: e.reasoning,
        human_feedback: e.humanFeedback,
        feedback_dirty: e.feedbackDirty,
        notification_sent: e.notificationSent,
        processed_at: e.processedAt,
        created_at: e.createdAt,
      })),
    },
  };
}

function importResultToJSON(r: ImportResult) {
  return {
    labels: r.labels,
    system_prompts: r.systemPrompts,
    ai_prompts: r.aiPrompts,
    memories: r.memories,
    sender_profiles: r.senderProfiles,
    wrapup_reports: r.wrapupReports,
    notifications: r.notifications,
    emails: r.emails,
  };
}

export async function handleExport(c: AppContext) {
  const userId = c.get('userId');
  const includeEmails = c.req.query('include_emails') === 'true';

  try {
    const envelope = await exportAllData(c.env.DB, userId, includeEmails);
    const json = envelopeToJSON(envelope);

    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', 'attachment; filename=gmail-triage-export.json');
    return c.body(JSON.stringify(json));
  } catch (e) {
    console.error('Failed to export data:', e);
    return c.json({ error: 'Failed to export data' }, 500);
  }
}

// Shape of the import body from the frontend (snake_case JSON).
// We need to transform back to camelCase for the importAllData function.
interface ImportBody {
  version: number;
  app: string;
  include_emails?: boolean;
  data: {
    labels?: Array<{ name: string; description: string; reasons: string[] }>;
    system_prompts?: Array<{ type: string; content: string }>;
    ai_prompts?: Array<{ type: string; content: string; version: number; created_at: string }>;
    memories?: Array<{
      type: string;
      content: string;
      reasoning: string;
      start_date: string;
      end_date: string;
      created_at: string;
    }>;
    sender_profiles?: Array<{
      profile_type: string;
      identifier: string;
      email_count: number;
      emails_archived: number;
      emails_notified: number;
      slug_counts: Record<string, number>;
      label_counts: Record<string, number>;
      keyword_counts: Record<string, number>;
      sender_type: string;
      summary: string;
      first_seen_at: string;
      last_seen_at: string;
    }>;
    wrapup_reports?: Array<{
      report_type: string;
      content: string;
      email_count: number;
      generated_at: string;
    }>;
    notifications?: Array<{
      email_id: string;
      from_address: string;
      subject: string;
      message: string;
      sent_at: string;
    }>;
    emails?: Array<{
      id: string;
      from_address: string;
      from_domain?: string;
      subject: string;
      slug: string;
      keywords: string[];
      summary: string;
      labels_applied: string[];
      bypassed_inbox: boolean;
      reasoning: string;
      human_feedback: string;
      feedback_dirty: boolean;
      notification_sent: boolean;
      processed_at: string;
      created_at: string;
    }>;
  };
}

export async function handleImport(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req.json<ImportBody>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON or file too large' }, 400);
  }

  if (body.app !== 'gmail-triage-assistant') {
    return c.json({ error: 'Invalid export file: wrong app identifier' }, 400);
  }
  if (body.version !== 1) {
    return c.json({ error: 'Unsupported export version' }, 400);
  }

  // Transform snake_case import body to camelCase ExportData
  const data = body.data;
  try {
    const result = await importAllData(c.env.DB, userId, {
      labels: (data.labels ?? []).map((l) => ({
        name: l.name,
        description: l.description,
        reasons: l.reasons,
      })),
      systemPrompts: (data.system_prompts ?? []).map((p) => ({
        type: p.type as 'email_analyze' | 'email_actions' | 'daily_review' | 'weekly_summary' | 'monthly_summary' | 'yearly_summary' | 'wrapup_report',
        content: p.content,
      })),
      aiPrompts: (data.ai_prompts ?? []).map((p) => ({
        type: p.type as 'email_analyze' | 'email_actions',
        content: p.content,
        version: p.version,
        createdAt: p.created_at,
      })),
      memories: (data.memories ?? []).map((m) => ({
        type: m.type as 'daily' | 'weekly' | 'monthly' | 'yearly',
        content: m.content,
        reasoning: m.reasoning,
        startDate: m.start_date,
        endDate: m.end_date,
        createdAt: m.created_at,
      })),
      senderProfiles: (data.sender_profiles ?? []).map((p) => ({
        profileType: p.profile_type as 'sender' | 'domain',
        identifier: p.identifier,
        emailCount: p.email_count,
        emailsArchived: p.emails_archived,
        emailsNotified: p.emails_notified,
        slugCounts: p.slug_counts,
        labelCounts: p.label_counts,
        keywordCounts: p.keyword_counts,
        senderType: p.sender_type,
        summary: p.summary,
        firstSeenAt: p.first_seen_at,
        lastSeenAt: p.last_seen_at,
      })),
      wrapupReports: (data.wrapup_reports ?? []).map((r) => ({
        reportType: r.report_type,
        content: r.content,
        emailCount: r.email_count,
        generatedAt: r.generated_at,
      })),
      notifications: (data.notifications ?? []).map((n) => ({
        emailId: n.email_id,
        fromAddress: n.from_address,
        subject: n.subject,
        message: n.message,
        sentAt: n.sent_at,
      })),
      emails: (data.emails ?? []).map((e) => ({
        id: e.id,
        fromAddress: e.from_address,
        fromDomain: e.from_domain ?? '',
        subject: e.subject,
        slug: e.slug,
        keywords: e.keywords,
        summary: e.summary,
        labelsApplied: e.labels_applied,
        bypassedInbox: e.bypassed_inbox,
        reasoning: e.reasoning,
        humanFeedback: e.human_feedback,
        feedbackDirty: e.feedback_dirty,
        notificationSent: e.notification_sent,
        processedAt: e.processed_at,
        createdAt: e.created_at,
      })),
    });

    return c.json(importResultToJSON(result));
  } catch (e) {
    console.error('Failed to import data:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: 'Import failed: ' + msg }, 500);
  }
}
