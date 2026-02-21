export interface PubSubMessage {
  message: {
    data: string
    messageId: string
    publishTime: string
  }
  subscription: string
}

export interface GmailPushNotification {
  emailAddress: string
  historyId: number
}

export function parsePubSubMessage(body: PubSubMessage): GmailPushNotification {
  const decoded = atob(body.message.data)
  return JSON.parse(decoded) as GmailPushNotification
}
