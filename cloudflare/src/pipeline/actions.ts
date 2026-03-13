import {
  getLabelId,
  createLabel,
  addLabels,
  archiveMessage,
} from '../services/gmail';

/**
 * Apply Gmail labels and optionally archive (bypass inbox) a message.
 *
 * For each label name we look up the Gmail label ID; if the label does not
 * exist yet we create it first. After collecting all IDs we apply them in a
 * single modify call, then archive if requested.
 */
export async function applyLabelsAndArchive(
  accessToken: string,
  messageId: string,
  labelNames: string[],
  bypassInbox: boolean,
): Promise<void> {
  // Resolve label names -> Gmail label IDs, creating missing labels on the fly
  if (labelNames.length > 0) {
    const labelIds: string[] = [];

    for (const name of labelNames) {
      let id = await getLabelId(accessToken, name);
      if (!id) {
        // Label doesn't exist — create it
        const created = await createLabel(accessToken, name);
        id = created.id;
      }
      labelIds.push(id);
    }

    if (labelIds.length > 0) {
      await addLabels(accessToken, messageId, labelIds);
    }
  }

  // Archive (remove from INBOX)
  if (bypassInbox) {
    await archiveMessage(accessToken, messageId);
  }
}
