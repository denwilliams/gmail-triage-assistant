# Deployment Guide

This guide walks through deploying the Gmail Triage Assistant to Cloudflare Workers for the first time.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Google Cloud project](https://console.cloud.google.com/) with billing enabled
- [OpenAI API key](https://platform.openai.com/api-keys)
- Node.js 18+ and `npm` installed locally
- Wrangler authenticated: `npx wrangler login`

---

## Step 1: Create Cloudflare Resources

Run these from the project directory. Each command will output IDs you need to copy into `wrangler.toml`.

### D1 Database

```bash
npx wrangler d1 create gmail-triage
```

Output will look like:
```
✅ Successfully created DB 'gmail-triage'

[[d1_databases]]
binding = "DB"
database_name = "gmail-triage"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← copy this
```

Open `wrangler.toml` and replace the `database_id` placeholder with the real value.

### KV Namespace (sessions)

```bash
npx wrangler kv namespace create SESSIONS
```

Output:
```
{ binding = 'SESSIONS', id = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }  # ← copy the id
```

Update the `id` under `[[kv_namespaces]]` in `wrangler.toml`.

### Queue

```bash
npx wrangler queues create email-processing
```

No ID to copy — it's referenced by name in `wrangler.toml` and that's already set.

---

## Step 2: Apply the Database Schema

```bash
npx wrangler d1 execute gmail-triage --file=src/db/schema.sql
```

This creates all the tables in production D1.

---

## Step 3: Google Cloud Setup

### 3a. Enable APIs

In [Google Cloud Console](https://console.cloud.google.com/):

1. Go to **APIs & Services → Library**
2. Enable **Gmail API**
3. Enable **Cloud Pub/Sub API**

### 3b. Create OAuth Credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Name: anything (e.g. "Gmail Triage")
4. Authorized redirect URIs: leave blank for now (you'll add it after deploy)
5. Click **Create** — copy the **Client ID** and **Client Secret**

### 3c. Create a Pub/Sub Topic

```bash
gcloud pubsub topics create gmail-triage
```

Or in the Cloud Console: **Pub/Sub → Topics → Create Topic**, name it `gmail-triage`.

### 3d. Grant Gmail Permission to Publish

```bash
gcloud pubsub topics add-iam-policy-binding gmail-triage \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

This lets Google's Gmail service publish push notifications to your topic.

---

## Step 4: Deploy to Cloudflare

```bash
npx wrangler deploy
```

This will output your worker URL, e.g.:
```
https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev
```

Note this URL — you need it for the next steps.

---

## Step 5: Set Secrets

Run each of these and paste the value when prompted:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OPENAI_API_KEY
```

```bash
# Set to your deployed worker URL + /auth/callback
npx wrangler secret put GOOGLE_REDIRECT_URL
# e.g.: https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev/auth/callback
```

```bash
# The Pub/Sub topic name from Step 3c
npx wrangler secret put PUBSUB_TOPIC
# e.g.: projects/YOUR-PROJECT-ID/topics/gmail-triage
```

```bash
# A random secret token to verify Pub/Sub requests (generate any random string)
npx wrangler secret put PUBSUB_VERIFICATION_TOKEN
# e.g.: openssl rand -hex 32
```

```bash
# The OpenAI model to use
npx wrangler secret put OPENAI_MODEL
# e.g.: gpt-4o-mini
```

```bash
# A random 32+ char string for session signing
npx wrangler secret put SESSION_SECRET
# e.g.: openssl rand -hex 32
```

---

## Step 6: Update Google OAuth Redirect URI

1. Go back to **APIs & Services → Credentials** in Google Cloud Console
2. Click your OAuth client
3. Under **Authorized redirect URIs**, add:
   ```
   https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev/auth/callback
   ```
4. Click **Save**

---

## Step 7: Create the Pub/Sub Push Subscription

Replace the placeholders and run:

```bash
gcloud pubsub subscriptions create gmail-triage-push \
  --topic=gmail-triage \
  --push-endpoint="https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev/api/gmail/push?token=YOUR-VERIFICATION-TOKEN" \
  --ack-deadline=30
```

- `YOUR-SUBDOMAIN` — your Cloudflare workers subdomain
- `YOUR-VERIFICATION-TOKEN` — the same value you set for `PUBSUB_VERIFICATION_TOKEN` in Step 5

---

## Step 8: Verify

1. Visit your worker URL: `https://gmail-triage-assistant.YOUR-SUBDOMAIN.workers.dev`
2. You should see the home page with a "Sign in with Google" button
3. Click it and complete the OAuth flow
4. You'll land on the dashboard — Gmail push notifications are now registered

---

## Step 9: Configure Labels

Before the AI can categorize emails, you need to create labels:

1. Go to `/labels`
2. Add labels like "Work", "Newsletter", "Receipts", etc.
3. Add descriptions to guide the AI (e.g. "Newsletters and marketing emails from companies")

---

## Redeploying

After code changes:

```bash
npx wrangler deploy
```

Secrets and D1 data are preserved between deploys.

---

## Checking Logs

```bash
npx wrangler tail
```

This streams live logs from your worker — useful for debugging email processing.

---

## Troubleshooting

### Emails not being processed

- Check `wrangler tail` for errors
- Verify the Pub/Sub subscription push endpoint URL is correct (including the `?token=` param)
- Confirm the Gmail watch registered — look for a log line `✓ Gmail watch renewed` after login
- Try re-authenticating (logout → login) to force a fresh `watchInbox()` call

### OAuth callback fails

- Double-check the redirect URI in Google Cloud Console exactly matches `GOOGLE_REDIRECT_URL`
- URIs are case-sensitive and must include the full path (`/auth/callback`)

### "Unauthorized" on push webhook

- The `token` query param in the Pub/Sub subscription URL must exactly match `PUBSUB_VERIFICATION_TOKEN`
- Recreate the subscription if you changed the token

### D1 errors

- If schema is missing: `npx wrangler d1 execute gmail-triage --file=src/db/schema.sql`
- Check `wrangler.toml` has the correct `database_id`
