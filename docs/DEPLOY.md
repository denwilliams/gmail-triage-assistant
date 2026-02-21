# Deployment Guide

This guide walks through deploying the Gmail Triage Assistant to Cloudflare Workers for the first time.

## How the pieces fit together

Before diving in, here's the full picture of what you're setting up and why each piece exists:

```
Your Gmail inbox
  └─→ Gmail notifies Google's Pub/Sub when new email arrives
        └─→ Pub/Sub pushes a notification to your Cloudflare Worker
              └─→ Worker enqueues {userId, messageId} to Cloudflare Queue
                    └─→ Queue consumer fetches + processes the email via OpenAI
                          └─→ Labels/archives the email in Gmail
                                └─→ Saves result to Cloudflare D1 (SQLite)
```

You're connecting three separate systems (Cloudflare, Google Cloud, OpenAI) so there are a few moving parts to wire up. Each step below explains what it's doing and why.

---

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Google Cloud project](https://console.cloud.google.com/) with billing enabled
- [OpenAI API key](https://platform.openai.com/api-keys)
- Node.js 18+ and `npm` installed locally
- Wrangler authenticated: `npx wrangler login`

---

## Step 1: Create Cloudflare Resources

The worker needs three Cloudflare resources before it can run: a database (D1), a key-value store for sessions (KV), and a queue for background email processing. These don't exist yet — you have to create them first, then tell the worker where to find them by putting their IDs into `wrangler.toml`.

Run all three commands from the project directory.

### D1 Database

D1 is where everything persistent lives: users, processed emails, labels, AI memories, and wrapup reports. Without it, the worker has nowhere to read or write data.

```bash
npx wrangler d1 create gmail-triage
```

The output will include a `database_id`. Copy it and paste it into `wrangler.toml` under `[[d1_databases]]`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "gmail-triage"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← paste here
```

### KV Namespace (sessions)

KV is a simple key-value store. The app uses it to store login sessions: when you sign in, a random token is stored here with a 7-day expiry. On every request, the worker looks up your session token in KV to know who you are. Without KV, authentication won't work.

```bash
npx wrangler kv namespace create SESSIONS
```

Copy the `id` from the output and paste it into `wrangler.toml` under `[[kv_namespaces]]`:

```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # ← paste here
```

### Queue

The email processing queue is what makes the architecture reliable. When Gmail sends a push notification, the worker can't spend 10+ seconds doing AI calls inline — Google will time out and retry endlessly. Instead, the push webhook immediately enqueues the email ID and returns 200. A separate Queue consumer then picks it up and does the heavy lifting (2 OpenAI calls, Gmail API calls, DB writes) with up to 15 minutes and automatic retries if something fails.

```bash
npx wrangler queues create email-processing
```

No ID to copy here — the queue is referenced by name in `wrangler.toml`, which is already set to `email-processing`.

---

## Step 2: Apply the Database Schema

The D1 database exists now, but it's empty — no tables yet. This step creates all the tables the app expects (`users`, `emails`, `labels`, `memories`, etc.).

```bash
npx wrangler d1 execute gmail-triage --file=src/db/schema.sql
```

You only need to run this once. Future deploys don't touch the database — your data is preserved.

---

## Step 3: Google Cloud Setup

This is the most involved part. The app needs Google for two things: OAuth (so users can sign in with their Google account) and Pub/Sub (so Gmail can notify the worker when new emails arrive instead of the worker having to poll).

### 3a. Enable APIs

By default, Google Cloud projects don't have any APIs turned on. You need to explicitly enable the ones you use — both the Gmail API (for reading/labelling emails and registering push notifications) and the Pub/Sub API (for receiving those notifications).

1. Go to **APIs & Services → Library** in the [Cloud Console](https://console.cloud.google.com/)
2. Search for and enable **Gmail API**
3. Search for and enable **Cloud Pub/Sub API**

### 3b. Create OAuth Credentials

OAuth is how users sign in. Google needs to know which app is requesting access to a user's Gmail — that's what the Client ID and Secret identify. The "authorized redirect URI" is a security measure: Google will only send the OAuth callback to URLs you've pre-approved, so nobody can steal auth codes by redirecting to a different server.

You can't add the redirect URI yet because you don't know your worker URL until after deploy (Step 4). Leave it blank for now and come back after Step 4.

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Name: anything (e.g. "Gmail Triage")
4. Authorized redirect URIs: leave blank for now
5. Click **Create** — save the **Client ID** and **Client Secret** somewhere safe

### 3c. Create a Pub/Sub Topic

A Pub/Sub topic is a named channel that messages flow through. Gmail will publish a notification to this topic whenever a new email arrives in a watched inbox. The subscription you'll create in Step 7 will forward those notifications to your worker.

```bash
gcloud pubsub topics create gmail-triage
```

Or in the Cloud Console: **Pub/Sub → Topics → Create Topic**, name it `gmail-triage`.

### 3d. Grant Gmail Permission to Publish

Gmail's push notification system runs as a Google-managed service account (`gmail-api-push@system.gserviceaccount.com`). By default it doesn't have permission to publish to your Pub/Sub topic — you'd get silent failures with no emails being processed. This command grants it publisher access.

```bash
gcloud pubsub topics add-iam-policy-binding gmail-triage \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

---

## Step 4: Deploy to Cloudflare

Now that the Cloudflare resources exist and `wrangler.toml` has their IDs, you can deploy the worker code. This uploads your TypeScript (compiled to a Workers bundle) and makes it live at a `workers.dev` URL.

```bash
npx wrangler deploy
```

The output will show your worker URL:
```
https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev
```

**Save this URL** — you need it for Steps 5, 6, and 7. The app won't work yet (secrets aren't set), but the URL is now yours.

---

## Step 5: Set Secrets

Secrets are environment variables that are encrypted at rest and never exposed in your code or logs. The worker reads them at runtime via `env.VARIABLE_NAME`. Without these, every request will fail — the worker won't know how to talk to Google or OpenAI.

Run each command and paste the value when prompted:

```bash
# From the OAuth credentials you created in Step 3b
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

```bash
# Your deployed worker URL + /auth/callback (from Step 4)
# e.g.: https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev/auth/callback
npx wrangler secret put GOOGLE_REDIRECT_URL
```

```bash
# The full Pub/Sub topic name from Step 3c
# e.g.: projects/YOUR-GCP-PROJECT-ID/topics/gmail-triage
npx wrangler secret put PUBSUB_TOPIC
```

```bash
# A random secret token — Pub/Sub will include this in push requests so the
# worker can verify they're genuinely from your subscription and not spoofed.
# Generate one: openssl rand -hex 32
npx wrangler secret put PUBSUB_VERIFICATION_TOKEN
```

```bash
# Your OpenAI API key
npx wrangler secret put OPENAI_API_KEY

# Which model to use (gpt-4o-mini is cheap and works well)
npx wrangler secret put OPENAI_MODEL
```

```bash
# A random string used to sign session tokens — keeps sessions secure.
# Generate one: openssl rand -hex 32
npx wrangler secret put SESSION_SECRET
```

---

## Step 6: Update Google OAuth Redirect URI

Remember the redirect URI you left blank in Step 3b? Now that you have your worker URL you can add it. Google will reject OAuth callbacks to any URL not on this list — this is what prevents auth token theft.

1. Go to **APIs & Services → Credentials** in the Cloud Console
2. Click your OAuth 2.0 client
3. Under **Authorized redirect URIs**, add:
   ```
   https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev/auth/callback
   ```
4. Click **Save**

---

## Step 7: Create the Pub/Sub Push Subscription

The topic (Step 3c) is the channel. The subscription is what actually delivers messages from that channel to your worker. A push subscription means Pub/Sub will POST to your worker's endpoint whenever a new message arrives — you don't have to poll.

The `?token=` parameter is how the worker verifies that incoming requests are genuinely from your Pub/Sub subscription and not someone else POSTing to the endpoint.

```bash
gcloud pubsub subscriptions create gmail-triage-push \
  --topic=gmail-triage \
  --push-endpoint="https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev/api/gmail/push?token=YOUR-VERIFICATION-TOKEN" \
  --ack-deadline=30
```

Replace:
- `YOUR-SUBDOMAIN` — your Cloudflare workers subdomain
- `YOUR-VERIFICATION-TOKEN` — the exact value you set for `PUBSUB_VERIFICATION_TOKEN` in Step 5

---

## Step 8: Sign In and Verify

Everything is now connected. Sign in to activate Gmail push notifications for your account.

1. Visit `https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev`
2. Click **Sign in with Google** and complete the OAuth flow
3. On success, the app calls Gmail's `watch()` API, which registers your inbox with the Pub/Sub topic. From this point on, Gmail will notify the worker whenever a new email arrives.
4. You'll land on the dashboard

To confirm it's working, send yourself a test email and check `/history` after a few seconds.

---

## Step 9: Configure Labels

The AI can only apply labels that you've told it about. Without any labels configured, it will still process and archive emails, but won't categorise them.

1. Go to `/labels`
2. Add labels matching ones you use in Gmail — e.g. "Work", "Newsletter", "Receipts"
3. Add a description for each to help the AI decide when to use it (e.g. "Marketing emails, promotions, and newsletters from companies")

---

## Redeploying after code changes

```bash
npx wrangler deploy
```

Secrets and D1 data are untouched between deploys — only the worker code updates.

---

## Checking Logs

```bash
npx wrangler tail
```

Streams live logs from your worker. Useful for watching emails get processed in real time or debugging failures.

---

## Troubleshooting

### Emails not being processed

- Run `npx wrangler tail` and send yourself an email — watch for log output
- Check the Pub/Sub subscription push endpoint URL is correct, including the `?token=` param
- After signing in, you should see `Enqueued N message(s)` in logs when email arrives
- If no logs appear at all, the Pub/Sub subscription isn't reaching your worker — verify the endpoint URL in the Cloud Console

### OAuth callback fails with "redirect_uri_mismatch"

- The URI in Google Cloud Console must exactly match what you set for `GOOGLE_REDIRECT_URL` — same protocol, domain, and path, character for character
- Check `wrangler secret list` to confirm `GOOGLE_REDIRECT_URL` is set

### "Unauthorized" on the push webhook

- The `token` param in the Pub/Sub subscription URL must exactly match `PUBSUB_VERIFICATION_TOKEN`
- If you regenerated the token, you need to delete and recreate the subscription with the new URL

### D1 errors / missing tables

```bash
npx wrangler d1 execute gmail-triage --file=src/db/schema.sql
```

Also verify `wrangler.toml` has the correct `database_id` from Step 1.
