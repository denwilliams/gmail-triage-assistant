import type { Env } from '../types/env';
import { getAllActiveUsers, updateUserToken, updateLastCheckedAt } from '../db/users';
import { getMessagesSince, refreshAccessToken } from '../services/gmail';

export async function pollGmail(env: Env): Promise<void> {
  const users = await getAllActiveUsers(env.DB);
  console.log(`poll-gmail: found ${users.length} active users`);

  for (const user of users) {
    try {
      // Check if token needs refresh
      const tokenExpiry = new Date(user.tokenExpiry).getTime();
      const now = Date.now();
      let accessToken = user.accessToken;

      if (tokenExpiry <= now) {
        console.log(`poll-gmail: refreshing token for user ${user.email}`);
        const result = await refreshAccessToken(
          env.GOOGLE_CLIENT_ID,
          env.GOOGLE_CLIENT_SECRET,
          user.refreshToken,
        );
        accessToken = result.access_token;
        const newExpiry = new Date(now + result.expires_in * 1000).toISOString();
        await updateUserToken(env.DB, user.id, accessToken, user.refreshToken, newExpiry);
      }

      // Determine since timestamp
      const sinceMs = user.lastCheckedAt ? new Date(user.lastCheckedAt).getTime() : now - 60 * 60 * 1000;

      // Fetch new messages
      const messages = await getMessagesSince(accessToken, sinceMs, 50);
      console.log(`poll-gmail: user ${user.email} — ${messages.length} new messages`);

      // Queue each message for processing
      let newestDate = sinceMs;
      for (const msg of messages) {
        await env.EMAIL_QUEUE.send({ userId: user.id, messageId: msg.id });
        if (msg.internalDate > newestDate) {
          newestDate = msg.internalDate;
        }
      }

      // Update lastCheckedAt
      const checkedAt = messages.length > 0 ? new Date(newestDate).toISOString() : new Date().toISOString();
      await updateLastCheckedAt(env.DB, user.id, checkedAt);
    } catch (err) {
      console.error(`poll-gmail: error for user ${user.email}:`, err);
      // Continue to next user
    }
  }
}
