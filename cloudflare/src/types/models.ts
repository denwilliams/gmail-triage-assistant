// ============================================================================
// Database row types (raw D1 representation — JSON as TEXT, booleans as 0/1)
// ============================================================================

export interface UserRow {
  id: number;
  email: string;
  google_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  is_active: number;
  last_checked_at: string | null;
  pushover_user_key: string;
  pushover_app_token: string;
  webhook_url: string;
  webhook_header_key: string;
  webhook_header_value: string;
  pipeline_version: string;
  // v2 settings (migration 0005)
  v2_newsletter_threshold: number;
  v2_human_rating_threshold: number;
  v2_calendar_imminent_minutes: number;
  v2_notify_buckets: string; // JSON map of bucket → boolean
  created_at: string;
  updated_at: string;
}

export interface EmailRow {
  id: string;
  user_id: number;
  from_address: string;
  from_domain: string;
  subject: string;
  slug: string;
  keywords: string;        // JSON TEXT
  summary: string;
  labels_applied: string;  // JSON TEXT
  bypassed_inbox: number;
  reasoning: string;
  human_feedback: string;
  feedback_dirty: number;
  notification_sent: number;
  draft_created: number;
  processed_at: string;
  created_at: string;
  // Pipeline (v2) columns — nullable for legacy rows
  bucket: string | null;
  pipeline_stage: string;
  triage_reasoning: string | null;
  triage_via: string | null;
  severity: string | null;
  urgency: string | null;
  interesting_score: number | null;
  interesting_reasons: string; // JSON TEXT
  in_reply_to: string | null;
  thread_id: string | null;
  included_in_digest: string | null;
  // Bucket-specific extractions (migration 0004) — nullable for rows that
  // weren't processed through the relevant bucket.
  vendor: string | null;
  document_type: string | null;
  amount: string | null;
  action_type: string | null;
  is_otp: number | null;
  event_title: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  event_attendees: string; // JSON TEXT
}

export interface LabelRow {
  id: number;
  user_id: number;
  name: string;
  reasons: string; // JSON TEXT
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemPromptRow {
  id: number;
  user_id: number;
  type: string;
  content: string;
  is_active: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIPromptRow {
  id: number;
  user_id: number;
  type: string;
  content: string;
  version: number;
  created_at: string;
}

export interface MemoryRow {
  id: number;
  user_id: number;
  type: string;
  content: string;
  reasoning: string;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface SenderProfileRow {
  id: number;
  user_id: number;
  profile_type: string;
  identifier: string;
  email_count: number;
  emails_archived: number;
  emails_notified: number;
  slug_counts: string;    // JSON TEXT
  label_counts: string;   // JSON TEXT
  keyword_counts: string; // JSON TEXT
  sender_type: string;
  summary: string;
  first_seen_at: string;
  last_seen_at: string;
  modified_at: string;
  created_at: string;
  // v2 pipeline columns
  rating: number | null;
  rating_reasoning: string;
  rating_manual: number;
  rating_updated_at: string | null;
  bucket_consistency: string;
  primary_bucket: string | null;
  bucket_counts: string;    // JSON TEXT
}

export interface WrapupReportRow {
  id: number;
  user_id: number;
  report_type: string;
  content: string;
  email_count: number;
  generated_at: string;
  created_at: string;
}

export interface NotificationRow {
  id: number;
  user_id: number;
  email_id: string;
  from_address: string;
  subject: string;
  message: string;
  sent_at: string;
  created_at: string;
}

// ============================================================================
// Application-level types (parsed JSON, real booleans)
// ============================================================================

export type PipelineVersion = 'v1' | 'v2';

export interface User {
  id: number;
  email: string;
  googleId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  isActive: boolean;
  lastCheckedAt: string | null;
  pushoverUserKey: string;
  pushoverAppToken: string;
  webhookUrl: string;
  webhookHeaderKey: string;
  webhookHeaderValue: string;
  pipelineVersion: PipelineVersion;
  // v2 settings (migration 0005) — all have defaults matching prior hardcoded values.
  v2NewsletterThreshold: number;       // 0..10, default 6
  v2HumanRatingThreshold: number;      // 0..99, default 40
  v2CalendarImminentMinutes: number;   // minutes, default 60
  v2NotifyBuckets: Partial<Record<Bucket, boolean>>;  // missing = allowed
  createdAt: string;
  updatedAt: string;
}

// Six concrete buckets the pipeline classifies into.
export type Bucket =
  | 'newsletter'
  | 'notification'
  | 'human'
  | 'transactional'
  | 'security'
  | 'calendar';

export const BUCKETS: Bucket[] = [
  'newsletter',
  'notification',
  'human',
  'transactional',
  'security',
  'calendar',
];

// Pipeline stage — tracks how far through processing an email has progressed.
export type PipelineStage = 'queued' | 'bucketed' | 'processed' | 'failed';

// How the triage decision was reached.
export type TriageVia = 'ai' | 'thread_reply' | 'consistent_sender';

// Sender profile bucket consistency assessment.
export type BucketConsistency = 'unknown' | 'consistent' | 'mixed';

export interface Email {
  id: string;
  userId: number;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  slug: string;
  keywords: string[];
  summary: string;
  labelsApplied: string[];
  bypassedInbox: boolean;
  reasoning: string;
  humanFeedback: string;
  feedbackDirty: boolean;
  notificationSent: boolean;
  draftCreated: boolean;
  processedAt: string;
  createdAt: string;
  // v2 pipeline fields — nullable for legacy rows.
  bucket: Bucket | null;
  pipelineStage: PipelineStage;
  triageReasoning: string | null;
  triageVia: TriageVia | null;
  severity: string | null;
  urgency: string | null;
  interestingScore: number | null;
  interestingReasons: string[];
  inReplyTo: string | null;
  threadId: string | null;
  includedInDigest: string | null;
  // Bucket-specific extractions — nullable for buckets that don't apply.
  vendor: string | null;
  documentType: string | null;
  amount: string | null;
  actionType: string | null;
  isOtp: boolean | null;
  eventTitle: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventLocation: string | null;
  eventAttendees: string[];
}

export interface Label {
  id: number;
  userId: number;
  name: string;
  reasons: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type PromptType =
  | 'email_analyze'
  | 'email_actions'
  | 'daily_review'
  | 'weekly_summary'
  | 'monthly_summary'
  | 'yearly_summary'
  | 'wrapup_report'
  | 'bucket_triage'
  | 'bucket_newsletter'
  | 'bucket_notification'
  | 'bucket_human'
  | 'bucket_transactional'
  | 'bucket_security'
  | 'bucket_calendar';

export interface SystemPrompt {
  id: number;
  userId: number;
  type: PromptType;
  content: string | null;
  isActive: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type AIPromptType = 'email_analyze' | 'email_actions';

export interface AIPrompt {
  id: number;
  userId: number;
  type: AIPromptType;
  content: string;
  version: number;
  createdAt: string;
}

export type MemoryType = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Memory {
  id: number;
  userId: number;
  type: MemoryType;
  content: string;
  reasoning: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export type ProfileType = 'sender' | 'domain';

export interface SenderProfile {
  id: number;
  userId: number;
  profileType: ProfileType;
  identifier: string;
  emailCount: number;
  emailsArchived: number;
  emailsNotified: number;
  slugCounts: Record<string, number>;
  labelCounts: Record<string, number>;
  keywordCounts: Record<string, number>;
  senderType: string;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
  modifiedAt: string;
  createdAt: string;
  // v2 pipeline additions.
  rating: number | null;
  ratingReasoning: string;
  ratingManual: boolean;
  ratingUpdatedAt: string | null;
  bucketConsistency: BucketConsistency;
  primaryBucket: Bucket | null;
  bucketCounts: Record<string, number>;
}

// ============================================================================
// Daily digests (v2 pipeline)
// ============================================================================

export interface DailyDigestRow {
  id: number;
  user_id: number;
  digest_date: string;
  content_html: string;
  content_text: string;
  sections: string;        // JSON TEXT
  item_counts: string;     // JSON TEXT
  sent_at: string | null;
  gmail_message_id: string | null;
  created_at: string;
}

export interface DigestNewsletterItem {
  emailId: string;
  fromAddress: string;
  subject: string;
  interestingScore: number;
  reasons: string[];
  summary: string;
}

export interface DigestNotificationItem {
  emailId: string;
  fromAddress: string;
  subject: string;
  severity: string;
  urgency: string;
  summary: string;
  reasoning: string;
}

export interface DigestQuietHumanItem {
  emailId: string;
  fromAddress: string;
  subject: string;
  rating: number;
  ratingReasoning: string;
  summary: string;
}

export interface DigestSections {
  newsletters: DigestNewsletterItem[];
  notifications: DigestNotificationItem[];
  quietHumans: DigestQuietHumanItem[];
}

export interface DigestItemCounts {
  newsletters: number;
  notifications: number;
  quietHumans: number;
}

export interface DailyDigest {
  id: number;
  userId: number;
  digestDate: string;
  contentHtml: string;
  contentText: string;
  sections: DigestSections;
  itemCounts: DigestItemCounts;
  sentAt: string | null;
  gmailMessageId: string | null;
  createdAt: string;
}

export interface WrapupReport {
  id: number;
  userId: number;
  reportType: string;
  content: string;
  emailCount: number;
  generatedAt: string;
  createdAt: string;
}

export interface Notification {
  id: number;
  userId: number;
  emailId: string;
  fromAddress: string;
  subject: string;
  message: string;
  sentAt: string;
  createdAt: string;
}

// ============================================================================
// Stats types
// ============================================================================

export interface SenderStat {
  address: string;
  count: number;
  archiveRate: number;
}

export interface DomainStat {
  domain: string;
  count: number;
  archiveRate: number;
}

export interface SlugStat {
  slug: string;
  count: number;
}

export interface LabelStat {
  label: string;
  count: number;
}

export interface KeywordStat {
  keyword: string;
  count: number;
}

export interface DashboardSummary {
  totalEmails: number;
  emailsToday: number;
  emailsThisWeek: number;
  uniqueSenders: number;
  bypassRate: number;
  notificationRate: number;
  topSenders: SenderStat[];
  topDomains: DomainStat[];
  topSlugs: SlugStat[];
  labelDistribution: LabelStat[];
  topKeywords: KeywordStat[];
  newSlugsThisWeek: number;
  recurringSlugsThisWeek: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface DayRate {
  date: string;
  total: number;
  count: number;
  rate: number;
}

export interface DayLabelCount {
  date: string;
  label: string;
  count: number;
}

export interface HourCount {
  dayOfWeek: number;
  hour: number;
  count: number;
}

export interface DashboardTimeseries {
  dailyVolume: DayCount[];
  dailyBypassRate: DayRate[];
  dailyNotifications: DayCount[];
  labelTrends: DayLabelCount[];
  hourlyHeatmap: HourCount[];
}

// ============================================================================
// Export / Import types
// ============================================================================

export interface ExportLabel {
  name: string;
  description: string;
  reasons: string[];
}

export interface ExportSystemPrompt {
  type: PromptType;
  content: string;
}

export interface ExportAIPrompt {
  type: AIPromptType;
  content: string;
  version: number;
  createdAt: string;
}

export interface ExportMemory {
  type: MemoryType;
  content: string;
  reasoning: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface ExportSenderProfile {
  profileType: ProfileType;
  identifier: string;
  emailCount: number;
  emailsArchived: number;
  emailsNotified: number;
  slugCounts: Record<string, number>;
  labelCounts: Record<string, number>;
  keywordCounts: Record<string, number>;
  senderType: string;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ExportEmail {
  id: string;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  slug: string;
  keywords: string[];
  summary: string;
  labelsApplied: string[];
  bypassedInbox: boolean;
  reasoning: string;
  humanFeedback: string;
  feedbackDirty: boolean;
  notificationSent: boolean;
  draftCreated: boolean;
  processedAt: string;
  createdAt: string;
}

export interface ExportWrapupReport {
  reportType: string;
  content: string;
  emailCount: number;
  generatedAt: string;
}

export interface ExportNotification {
  emailId: string;
  fromAddress: string;
  subject: string;
  message: string;
  sentAt: string;
}

export interface ExportData {
  labels: ExportLabel[];
  systemPrompts: ExportSystemPrompt[];
  aiPrompts: ExportAIPrompt[];
  memories: ExportMemory[];
  senderProfiles: ExportSenderProfile[];
  wrapupReports: ExportWrapupReport[];
  notifications: ExportNotification[];
  emails?: ExportEmail[];
}

export interface ExportEnvelope {
  version: number;
  exportedAt: string;
  app: string;
  includeEmails: boolean;
  data: ExportData;
}

export interface ImportResult {
  labels: number;
  systemPrompts: number;
  aiPrompts: number;
  memories: number;
  senderProfiles: number;
  wrapupReports: number;
  notifications: number;
  emails: number;
}
