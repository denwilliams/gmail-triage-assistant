export type Bucket =
  | 'newsletter'
  | 'notification'
  | 'human'
  | 'transactional'
  | 'security'
  | 'calendar';

export const BUCKETS: Bucket[] = [
  'human',
  'calendar',
  'security',
  'notification',
  'transactional',
  'newsletter',
];

export type RangeId = 'day' | 'week' | 'month' | '24h' | '7d' | '28d';

export interface EmailItem {
  id: string;
  thread_id: string | null;
  from_address: string;
  subject: string;
  summary: string;
  processed_at: string;
  bucket: Bucket;
  severity: string | null;
  urgency: string | null;
  interesting_score: number | null;
  interesting_reasons: string[];
  vendor: string | null;
  document_type: string | null;
  amount: string | null;
  action_type: string | null;
  is_otp: boolean | null;
  event_title: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  triage_via: string | null;
  is_read: boolean;
  archived_at: string | null;
  collapsed: boolean;
}

export interface Rating {
  rating: number | null;
  manual: boolean;
}

export interface EmailsResponse {
  range: RangeId;
  start: string;
  end: string;
  anchor: string | null;
  prev_anchor: string | null;
  next_anchor: string | null;
  today: string;
  timezone: string;
  truncated: boolean;
  emails: EmailItem[];
  ratings: Record<string, Rating>;
}

export interface EmailContent {
  from_header: string;
  reply_to: string;
  subject: string;
  text: string;
  html: string;
}
