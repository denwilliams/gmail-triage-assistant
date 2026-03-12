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
  processed_at: string;
  created_at: string;
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
  createdAt: string;
  updatedAt: string;
}

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
  processedAt: string;
  createdAt: string;
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
  | 'wrapup_report';

export interface SystemPrompt {
  id: number;
  userId: number;
  type: PromptType;
  content: string;
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
