import type { Env } from '../types/env';
import { getAllActiveUsers, updateUserToken } from '../db/users';
import {
  getLabelId,
  listMessagesByLabel,
  getMessageMetadata,
  removeLabels,
  archiveMessage,
  trashMessage,
  refreshAccessToken,
} from '../services/gmail';

interface TimedLabel {
  name: string;
  maxAgeMs: number;
}

const ARCHIVE_LABELS: TimedLabel[] = [
  { name: '📥/1d', maxAgeMs: 1 * 24 * 60 * 60 * 1000 },
  { name: '📥/1w', maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  { name: '📥/1m', maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
  { name: '📥/1y', maxAgeMs: 365 * 24 * 60 * 60 * 1000 },
];

const DELETE_LABELS: TimedLabel[] = [
  { name: '🗑️/1d', maxAgeMs: 1 * 24 * 60 * 60 * 1000 },
  { name: '🗑️/1w', maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  { name: '🗑️/1m', maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
  { name: '🗑️/1y', maxAgeMs: 365 * 24 * 60 * 60 * 1000 },
];

export async function processTimedLabels(env: Env): Promise<void> {
  const users = await getAllActiveUsers(env.DB);

  for (const user of users) {
    try {
      let accessToken = user.accessToken;

      // Refresh token if expired
      if (new Date(user.tokenExpiry) <= new Date()) {
        try {
          const refreshed = await refreshAccessToken(
            env.GOOGLE_CLIENT_ID,
            env.GOOGLE_CLIENT_SECRET,
            user.refreshToken,
          );
          accessToken = refreshed.access_token;
          const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
          await updateUserToken(env.DB, user.id, accessToken, user.refreshToken, newExpiry);
        } catch (e) {
          console.error(`timed-labels: token refresh failed for ${user.email}:`, e);
          continue;
        }
      }

      // Process archive labels
      for (const tl of ARCHIVE_LABELS) {
        await processLabel(accessToken, tl, false);
      }

      // Process delete labels
      for (const tl of DELETE_LABELS) {
        await processLabel(accessToken, tl, true);
      }

      // Process archive-after-read
      await processArchiveAfterRead(accessToken);

      console.log(`timed-labels: processed for ${user.email}`);
    } catch (e) {
      console.error(`timed-labels: failed for ${user.email}:`, e);
    }
  }
}

const ARCHIVE_AFTER_READ_LABEL = '📥/read';

async function processArchiveAfterRead(accessToken: string): Promise<void> {
  const labelId = await getLabelId(accessToken, ARCHIVE_AFTER_READ_LABEL);
  if (!labelId) return;

  // List messages with this label that are NOT unread (i.e., have been read)
  const messages = await listMessagesByLabel(accessToken, labelId, '-is:unread');
  if (messages.length === 0) return;

  for (const msg of messages) {
    try {
      await removeLabels(accessToken, msg.id, [labelId]);
      await archiveMessage(accessToken, msg.id);
    } catch (e) {
      console.error(`timed-labels: failed to archive read message ${msg.id}:`, e);
    }
  }
}

async function processLabel(accessToken: string, tl: TimedLabel, trash: boolean): Promise<void> {
  // Find the label ID
  const labelId = await getLabelId(accessToken, tl.name);
  if (!labelId) return; // Label doesn't exist yet, nothing to process

  // List messages with this label
  const messages = await listMessagesByLabel(accessToken, labelId);
  if (messages.length === 0) return;

  const cutoff = Date.now() - tl.maxAgeMs;

  for (const msg of messages) {
    try {
      // Get message date
      const metadata = await getMessageMetadata(accessToken, msg.id);

      if (metadata.internalDate < cutoff) {
        // Remove the timed label first
        await removeLabels(accessToken, msg.id, [labelId]);

        if (trash) {
          await trashMessage(accessToken, msg.id);
        } else {
          await archiveMessage(accessToken, msg.id);
        }
      }
    } catch (e) {
      // Log and continue -- don't let one message failure block others
      console.error(`timed-labels: failed to process message ${msg.id}:`, e);
    }
  }
}
