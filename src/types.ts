export type PromptType =
  | 'email_analyze'
  | 'email_actions'
  | 'daily_review'
  | 'weekly_summary'
  | 'monthly_summary'
  | 'yearly_summary'
  | 'wrapup_report'

export type MemoryType = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface User {
  id: number
  email: string
  google_id: string
  access_token: string
  refresh_token: string
  token_expiry: string
  is_active: number
  last_checked_at: string | null
  gmail_history_id: string | null
  created_at: string
  updated_at: string
}

export interface Email {
  id: string
  user_id: number
  from_address: string
  subject: string
  slug: string
  keywords: string[]
  labels_applied: string[]
  summary: string
  bypassed_inbox: boolean
  reasoning: string
  human_feedback: string
  processed_at: string
  created_at: string
}

export interface Label {
  id: number
  user_id: number
  name: string
  reasons: string[]
  description: string
  created_at: string
  updated_at: string
}

export interface SystemPrompt {
  id: number
  user_id: number
  type: PromptType
  content: string
  is_active: number
  description: string
  created_at: string
  updated_at: string
}

export interface Memory {
  id: number
  user_id: number
  type: MemoryType
  content: string
  start_date: string
  end_date: string
  created_at: string
}

export interface WrapupReport {
  id: number
  user_id: number
  report_type: string
  email_count: number
  content: string
  generated_at: string
  created_at: string
}

export interface SessionData {
  userId: number
  email: string
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  internalDate: string
  payload: {
    headers: { name: string; value: string }[]
    mimeType: string
    body: { data?: string }
    parts?: GmailMessage['payload'][]
  }
}

export interface ParsedMessage {
  id: string
  threadId: string
  subject: string
  from: string
  body: string
  labelIds: string[]
  internalDate: number
}

export interface EmailAnalysis {
  slug: string
  keywords: string[]
  summary: string
}

export interface EmailActions {
  labels: string[]
  bypass_inbox: boolean
  reasoning: string
}
