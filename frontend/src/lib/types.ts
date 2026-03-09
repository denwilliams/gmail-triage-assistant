export interface Label {
  id: number;
  user_id: number;
  name: string;
  reasons: string[];
  description: string;
  created_at: string;
  updated_at: string;
}

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
  pushover_user_key: string;
  pushover_configured: boolean;
}

export interface AuthUser {
  email: string;
  user_id: number;
}

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

export interface DashboardTimeseries {
  daily_volume: DayCount[];
  daily_bypass_rate: DayRate[];
  daily_notifications: DayCount[];
  label_trends: DayLabelCount[];
  hourly_heatmap: HourCount[];
}
