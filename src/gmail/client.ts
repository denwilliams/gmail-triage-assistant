import type { GmailMessage, ParsedMessage } from '../types'

export class GmailClient {
  private accessToken: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gmail API ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  async getMessage(messageId: string): Promise<ParsedMessage> {
    const msg = await this.request<GmailMessage>(`messages/${messageId}?format=full`)
    return parseMessage(msg)
  }

  async getUnreadMessages(maxResults = 50): Promise<ParsedMessage[]> {
    const list = await this.request<{ messages?: { id: string }[] }>(
      `messages?q=is:unread+in:inbox&maxResults=${maxResults}`
    )
    if (!list.messages?.length) return []
    return Promise.all(list.messages.map(m => this.getMessage(m.id)))
  }

  async addLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.request(`messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: labelIds }),
    })
  }

  async archiveMessage(messageId: string): Promise<void> {
    await this.request(`messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
    })
  }

  async listLabels(): Promise<{ id: string; name: string }[]> {
    const res = await this.request<{ labels: { id: string; name: string }[] }>('labels')
    return res.labels
  }

  async getLabelId(name: string): Promise<string | null> {
    const labels = await this.listLabels()
    return labels.find(l => l.name === name)?.id ?? null
  }

  async createLabel(name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>('labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
        type: 'user',
      }),
    })
  }

  async getOrCreateLabelId(name: string): Promise<string> {
    const id = await this.getLabelId(name)
    if (id) return id
    const label = await this.createLabel(name)
    return label.id
  }

  async watchInbox(topicName: string): Promise<{ historyId: string; expiration: string }> {
    return this.request<{ historyId: string; expiration: string }>('watch', {
      method: 'POST',
      body: JSON.stringify({
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include',
      }),
    })
  }

  async getMessagesSince(historyId: string): Promise<ParsedMessage[]> {
    try {
      const res = await this.request<{
        history?: { messagesAdded?: { message: { id: string } }[] }[]
        historyId?: string
      }>(`history?startHistoryId=${historyId}&historyTypes=messageAdded&labelId=INBOX`)

      const messageIds = new Set<string>()
      for (const h of res.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          messageIds.add(m.message.id)
        }
      }

      if (!messageIds.size) return []
      return Promise.all([...messageIds].map(id => this.getMessage(id)))
    } catch {
      return []
    }
  }
}

function parseMessage(msg: GmailMessage): ParsedMessage {
  let subject = ''
  let from = ''
  for (const h of msg.payload.headers) {
    if (h.name === 'Subject') subject = h.value
    if (h.name === 'From') from = h.value
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    body: extractBody(msg.payload),
    labelIds: msg.labelIds,
    internalDate: parseInt(msg.internalDate, 10),
  }
}

function extractBody(payload: GmailMessage['payload']): string {
  if (payload.mimeType === 'text/plain' && payload.body.data) {
    return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'))
  }
  for (const part of payload.parts ?? []) {
    const body = extractBody(part)
    if (body) return body
  }
  return ''
}
