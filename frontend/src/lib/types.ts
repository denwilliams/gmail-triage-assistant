export interface Label {
  id: number;
  user_id: number;
  name: string;
  reasons: string[];
  description: string;
  created_at: string;
  updated_at: string;
}

export type TriageVia = "ai" | "thread_reply" | "consistent_sender";
export type PipelineStage = "queued" | "bucketed" | "processed" | "failed";

export interface V2FailureRow {
  id: string;
  from_address: string;
  subject: string;
  bucket: Bucket | null;
  pipeline_stage: PipelineStage;
  processed_at: string;
}

export interface V2PipelineStats {
  total_v2: number;
  total_v2_today: number;
  total_v2_this_week: number;
  bucket_counts_today: Record<Bucket, number>;
  bucket_counts_week: Record<Bucket, number>;
  triage_via_week: Record<TriageVia, number>;
  stage_counts: Record<PipelineStage, number>;
  digest_included_week: number;
  recent_failures: V2FailureRow[];
}

export type SenderProfileSort =
  | "volume"
  | "recent"
  | "rating_high"
  | "rating_low"
  | "consistency";

export interface Email {
  id: string;
  user_id: number;
  from_address: string;
  subject: string;
  slug: string;
  keywords: string[];
  summary: string;
  labels_applied: string[];
  bypassed_inbox: boolean;
  notification_sent: boolean;
  reasoning: string;
  human_feedback: string;
  feedback_dirty: boolean;
  processed_at: string;
  created_at: string;
  // v2 pipeline fields — null/undefined for legacy v1 rows.
  bucket?: Bucket | null;
  pipeline_stage?: PipelineStage;
  triage_via?: TriageVia | null;
  triage_reasoning?: string | null;
  severity?: string | null;
  urgency?: string | null;
  interesting_score?: number | null;
  interesting_reasons?: string[];
  in_reply_to?: string | null;
  thread_id?: string | null;
  included_in_digest?: string | null;
  // Bucket-specific extractions (migration 0004).
  vendor?: string | null;
  document_type?: string | null;
  amount?: string | null;
  action_type?: string | null;
  is_otp?: boolean | null;
  event_title?: string | null;
  event_starts_at?: string | null;
  event_ends_at?: string | null;
  event_location?: string | null;
  event_attendees?: string[];
}

export interface BucketTotals {
  all_time: number;
  month: number;
  week: number;
}

export interface BucketEmailRef {
  id: string;
  subject: string;
  from_address: string;
  processed_at: string;
}

export interface NewsletterSenderStat {
  address: string;
  count: number;
  avg_score: number;
  max_score: number;
  digest_included: number;
}

export interface NewsletterBucketStats {
  bucket: "newsletter";
  totals: BucketTotals;
  score_histogram: { score: number; count: number }[];
  top_scoring_senders: NewsletterSenderStat[];
  digest_included_week: number;
  digest_included_month: number;
  top_interesting: (BucketEmailRef & { score: number; reasons: string[] })[];
}

export interface NoisySenderStat {
  address: string;
  count: number;
  notified: number;
  high_count: number;
}

export interface NotificationBucketStats {
  bucket: "notification";
  totals: BucketTotals;
  severity_counts: Record<string, number>;
  urgency_counts: Record<string, number>;
  severity_urgency_matrix: { severity: string; urgency: string; count: number }[];
  noisiest_senders: NoisySenderStat[];
  recent_high: (BucketEmailRef & {
    severity: string | null;
    urgency: string | null;
    summary: string;
  })[];
}

export interface HumanSenderSnapshot {
  id: number;
  identifier: string;
  rating: number | null;
  rating_reasoning: string;
  rating_manual: boolean;
  email_count: number;
  last_seen_at: string;
}

export interface HumanBucketStats {
  bucket: "human";
  totals: BucketTotals;
  rating_histogram: { bucket: string; count: number }[];
  at_threshold: HumanSenderSnapshot[];
  quiet_humans: HumanSenderSnapshot[];
  unrated_senders: number;
  rated_senders: number;
}

export interface VendorStat {
  vendor: string;
  count: number;
  last_seen_at: string;
}

export interface TransactionalBucketStats {
  bucket: "transactional";
  totals: BucketTotals;
  top_vendors: VendorStat[];
  document_type_counts: { type: string; count: number }[];
  recent: (BucketEmailRef & {
    vendor: string | null;
    document_type: string | null;
    amount: string | null;
  })[];
}

export interface SecurityBucketStats {
  bucket: "security";
  totals: BucketTotals;
  action_type_counts: { type: string; count: number }[];
  otp_count: number;
  otp_count_month: number;
  recent: (BucketEmailRef & {
    action_type: string | null;
    is_otp: boolean | null;
    summary: string;
  })[];
}

export interface CalendarEventRef extends BucketEmailRef {
  event_title: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  event_attendees: string[];
}

export interface CalendarBucketStats {
  bucket: "calendar";
  totals: BucketTotals;
  upcoming: CalendarEventRef[];
  recent_past: CalendarEventRef[];
  undated_count: number;
}

export type BucketStats =
  | NewsletterBucketStats
  | NotificationBucketStats
  | HumanBucketStats
  | TransactionalBucketStats
  | SecurityBucketStats
  | CalendarBucketStats;

export interface PipelineStageModel {
  stage: string;
  configured_model: string | null;
  effective_model: string;
}

export interface PipelineConfig {
  default_model: string;
  openai_base_url: string;
  stages: PipelineStageModel[];
}

export interface StuckEmailRow {
  id: string;
  from_address: string;
  subject: string;
  bucket: Bucket | null;
  pipeline_stage: PipelineStage;
  triage_via: TriageVia | null;
  processed_at: string;
  created_at: string;
  reasoning: string;
}

export interface PipelineOps {
  stuck: StuckEmailRow[];
  failed: StuckEmailRow[];
  daily_throughput: { date: string; processed: number; failed: number }[];
}

export interface SystemPrompt {
  id: number;
  user_id: number;
  type: string;
  content: string;
  is_active: boolean;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface AIPrompt {
  id: number;
  user_id: number;
  type: string;
  content: string;
  version: number;
  created_at: string;
}

export interface Memory {
  id: number;
  user_id: number;
  type: "daily" | "weekly" | "monthly" | "yearly";
  content: string;
  reasoning: string;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface WrapupReport {
  id: number;
  user_id: number;
  report_type: string;
  content: string;
  email_count: number;
  generated_at: string;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: number;
  email_id: string;
  from_address: string;
  subject: string;
  message: string;
  sent_at: string;
  created_at: string;
}

export interface PromptsResponse {
  prompts: SystemPrompt[];
  ai_analyze: AIPrompt | null;
  ai_actions: AIPrompt | null;
}

export interface UserSettings {
  processing_enabled: boolean;
  pipeline_version: "v1" | "v2";
  pushover_user_key: string;
  pushover_configured: boolean;
  webhook_url: string;
  webhook_header_key: string;
  webhook_header_value: string;
  webhook_configured: boolean;
  // v2 pipeline settings (migration 0005)
  v2_newsletter_threshold: number;
  v2_human_rating_threshold: number;
  v2_calendar_imminent_minutes: number;
  v2_notify_buckets: Partial<Record<Bucket, boolean>>;
}

export interface V2SettingsUpdate {
  newsletter_threshold?: number;
  human_rating_threshold?: number;
  calendar_imminent_minutes?: number;
  notify_buckets?: Partial<Record<Bucket, boolean>>;
}

export interface ImportResult {
  labels: number;
  system_prompts: number;
  ai_prompts: number;
  memories: number;
  sender_profiles: number;
  wrapup_reports: number;
  notifications: number;
  emails: number;
}

export interface AuthUser {
  email: string;
  user_id: number;
}

export type Bucket =
  | "newsletter"
  | "notification"
  | "human"
  | "transactional"
  | "security"
  | "calendar";

export type BucketConsistency = "unknown" | "consistent" | "mixed";

export interface SenderProfile {
  id: number;
  profile_type: "sender" | "domain";
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
  rating: number | null;
  rating_reasoning: string;
  rating_manual: boolean;
  rating_updated_at: string | null;
  bucket_consistency: BucketConsistency;
  primary_bucket: Bucket | null;
  bucket_counts: Record<string, number>;
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

export interface DailyDigest {
  id: number;
  userId: number;
  digestDate: string;
  contentHtml: string;
  contentText: string;
  sections: {
    newsletters: DigestNewsletterItem[];
    notifications: DigestNotificationItem[];
    quietHumans: DigestQuietHumanItem[];
  };
  itemCounts: {
    newsletters: number;
    notifications: number;
    quietHumans: number;
  };
  sentAt: string | null;
  gmailMessageId: string | null;
  createdAt: string;
}

export interface SenderProfilesResponse {
  sender: SenderProfile | null;
  domain: SenderProfile | null;
}

// Dashboard stats types

export interface SenderStatItem {
  address: string;
  count: number;
  archive_rate: number;
}

export interface DomainStatItem {
  domain: string;
  count: number;
  archive_rate: number;
}

export interface SlugStatItem {
  slug: string;
  count: number;
}

export interface LabelStatItem {
  label: string;
  count: number;
}

export interface KeywordStatItem {
  keyword: string;
  count: number;
}

export interface DashboardSummary {
  total_emails: number;
  emails_today: number;
  emails_this_week: number;
  unique_senders: number;
  bypass_rate: number;
  notification_rate: number;
  top_senders: SenderStatItem[];
  top_domains: DomainStatItem[];
  top_slugs: SlugStatItem[];
  label_distribution: LabelStatItem[];
  top_keywords: KeywordStatItem[];
  new_slugs_this_week: number;
  recurring_slugs_this_week: number;
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
  day_of_week: number;
  hour: number;
  count: number;
}

// Prompt Wizard types

export interface WizardOption {
  value: string;
  label: string;
}

export interface WizardQuestion {
  id: string;
  text: string;
  type: "single_select" | "multi_select" | "text";
  options: WizardOption[];
}

export interface WizardAnswer {
  question_id: string;
  question: string;
  answer: string;
}

export interface WizardPrompts {
  email_analyze: string;
  email_actions: string;
}

export interface WizardStartResponse {
  done: boolean;
  message: string;
  questions: WizardQuestion[];
  prompts: WizardPrompts;
  email_summary: string;
}

export interface WizardContinueRequest {
  email_summary: string;
  history: WizardAnswer[];
}

export interface WizardContinueResponse {
  done: boolean;
  message: string;
  questions: WizardQuestion[];
  prompts: WizardPrompts;
}

export interface DashboardTimeseries {
  daily_volume: DayCount[];
  daily_bypass_rate: DayRate[];
  daily_notifications: DayCount[];
  label_trends: DayLabelCount[];
  hourly_heatmap: HourCount[];
}
