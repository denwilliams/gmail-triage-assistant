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
