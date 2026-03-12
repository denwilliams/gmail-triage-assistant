// Pushover notification client using Workers fetch()

/**
 * Send a push notification via the Pushover API.
 */
export async function sendPushover(
  userKey: string,
  appToken: string,
  title: string,
  message: string,
): Promise<void> {
  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: appToken,
      user: userKey,
      title,
      message,
    }),
  });

  if (!res.ok) {
    throw new Error(`Pushover error: ${res.status}`);
  }
}
