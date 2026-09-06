import type { Env } from '../types/env';
import { getAllActiveUsers, updateUserToken } from '../db/users';
import {
  getLabelId,
  listMessagesByLabel,
  removeLabels,
  archiveMessage,
  trashMessage,
  refreshAccessToken,
} from '../services/gmail';

export interface TimedLabel {
  name: string;
  /** Gmail `older_than:` operator value, e.g. "30d". */
  olderThan: string;
}

const ARCHIVE_LABELS: TimedLabel[] = [
  { name: '📥/1d', olderThan: '1d' },
  { name: '📥/1w', olderThan: '7d' },
  { name: '📥/1m', olderThan: '30d' },
  { name: '📥/1y', olderThan: '365d' },
];

export const DELETE_LABELS: TimedLabel[] = [
  { name: '🗑️/1d', olderThan: '1d' },
  { name: '🗑️/1w', olderThan: '7d' },
  { name: '🗑️/1m', olderThan: '30d' },
  { name: '🗑️/1y', olderThan: '365d' },
];

export async function processTimedLabels(env: Env): Promise<void> {
  const autoDeleteEnabled = env.AUTO_DELETE_ENABLED === 'true';
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

      // Process archive labels (non-destructive — always on)
      for (const tl of ARCHIVE_LABELS) {
        await processLabel(accessToken, tl, false);
      }

      // Process delete labels — only when explicitly enabled. Deletion is
      // otherwise left to the manual review page (see api/delete-review.ts).
      if (autoDeleteEnabled) {
        for (const tl of DELETE_LABELS) {
          await processLabel(accessToken, tl, true);
        }
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

/**
 * Message IDs under `labelId` currently past `tl`'s age cutoff, using Gmail's
 * `older_than:` search operator so age filtering happens server-side rather
 * than via a per-message metadata fetch.
 */
export async function listDueMessageIds(
  accessToken: string,
  labelId: string,
  tl: TimedLabel,
): Promise<string[]> {
  const messages = await listMessagesByLabel(accessToken, labelId, `older_than:${tl.olderThan}`);
  return messages.map((m) => m.id);
}

/** Resolve a timed label by name and return its currently-due message IDs. */
export async function listDueMessages(accessToken: string, tl: TimedLabel): Promise<string[]> {
  const labelId = await getLabelId(accessToken, tl.name);
  if (!labelId) return [];
  return listDueMessageIds(accessToken, labelId, tl);
}

async function processLabel(accessToken: string, tl: TimedLabel, trash: boolean): Promise<void> {
  const labelId = await getLabelId(accessToken, tl.name);
  if (!labelId) return; // Label doesn't exist yet, nothing to process

  const dueIds = await listDueMessageIds(accessToken, labelId, tl);

  for (const id of dueIds) {
    try {
      // Remove the timed label first
      await removeLabels(accessToken, id, [labelId]);

      if (trash) {
        await trashMessage(accessToken, id);
      } else {
        await archiveMessage(accessToken, id);
      }
    } catch (e) {
      // Log and continue -- don't let one message failure block others
      console.error(`timed-labels: failed to process message ${id}:`, e);
    }
  }
}
