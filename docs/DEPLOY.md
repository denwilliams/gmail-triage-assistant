# Deployment Guide: Cloudflare Tunnel + Raspberry Pi

## Architecture

```
Browser → Cloudflare Edge (HTTPS) → cloudflared tunnel → Go app on Pi → PostgreSQL on Pi
```

The Go backend runs on your Raspberry Pi. `cloudflared` (Cloudflare's tunnel daemon) creates an outbound connection from the Pi to Cloudflare's network, giving the app a stable public HTTPS URL without port forwarding, a static IP, or a domain pointed at your home. The browser connects to Cloudflare, which forwards traffic through the tunnel to the Pi.

---

## Prerequisites

- Raspberry Pi running Raspberry Pi OS (64-bit recommended)
- Docker and Docker Compose installed on the Pi
- Cloudflare account (free tier)
- A domain name added to Cloudflare (or use `*.trycloudflare.com` for testing — no account needed)
- Google Cloud project with billing enabled
- OpenAI API key

---

## Step 1: Install and set up cloudflared on the Pi

`cloudflared` is the daemon that maintains the tunnel. It makes outbound connections to Cloudflare — no inbound ports needed. You do not need to open any firewall rules or configure port forwarding on your router.

```bash
# Install cloudflared (ARM64 for Pi 4/5)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo install cloudflared /usr/local/bin/
cloudflared --version

# Log in to your Cloudflare account
cloudflared tunnel login
# This opens a browser — authorize the domain you want to use

# Create a named tunnel (keeps the same URL across restarts)
cloudflared tunnel create gmail-triage
# Save the tunnel ID shown in the output — you'll need it in the next step
```

A named tunnel persists across restarts. The credentials file created here (`~/.cloudflared/<TUNNEL-ID>.json`) is what authenticates the Pi to Cloudflare. Without a named tunnel, the URL would change every time `cloudflared` restarts, breaking your OAuth redirect URI and Pub/Sub subscription.

---

## Step 2: Configure the tunnel

```bash
cp deploy/cloudflare-tunnel.yml.example ~/.cloudflared/config.yml
# Edit ~/.cloudflared/config.yml:
# - Replace YOUR-TUNNEL-ID with the tunnel ID from Step 1
# - Replace your-hostname.your-domain.com with your desired subdomain
```

The config file tells `cloudflared` which tunnel to use and where to route traffic (`localhost:8080` — where the Go app will listen). Without this file, you would have to pass all options on the command line every time.

---

## Step 3: Create a DNS record for your tunnel

```bash
cloudflared tunnel route dns gmail-triage your-hostname.your-domain.com
```

This creates a CNAME record in your Cloudflare DNS pointing your chosen hostname to the tunnel. Without this, nobody can reach the tunnel by name — the tunnel exists but has no public address.

**Testing without a domain:** Run `cloudflared tunnel --url http://localhost:8080` for a temporary `*.trycloudflare.com` URL — no login required. This is useful for testing but the URL changes on every restart, so it is not suitable for a permanent deployment.

---

## Step 4: Google Cloud Setup

The app needs Google for two things: OAuth (sign in with Google) and Pub/Sub (Gmail push notifications instead of polling). Push notifications mean Gmail immediately tells your app when a new email arrives, rather than the app having to repeatedly ask.

### 4a. Enable APIs

1. Go to [APIs & Services → Library](https://console.cloud.google.com/)
2. Enable **Gmail API**
3. Enable **Cloud Pub/Sub API**

### 4b. Create OAuth credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Authorized redirect URIs: `https://your-hostname.your-domain.com/auth/callback`
4. Save the **Client ID** and **Client Secret**

The redirect URI must match the `GOOGLE_REDIRECT_URL` env var exactly. Google rejects OAuth callbacks to unlisted URLs — even a trailing slash difference will cause an error.

### 4c. Create Pub/Sub topic

```bash
gcloud pubsub topics create gmail-triage

# Grant Gmail permission to publish to your topic
gcloud pubsub topics add-iam-policy-binding gmail-triage \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

Gmail's push notification system runs as a Google-managed service account (`gmail-api-push@system.gserviceaccount.com`). Without this IAM binding, Gmail cannot publish notifications to your topic and no emails will be processed automatically.

---

## Step 5: Configure the app

```bash
cp .env.example .env
# Edit .env with your actual values:
# - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET from Step 4b
# - GOOGLE_REDIRECT_URL: https://your-hostname.your-domain.com/auth/callback
# - OPENAI_API_KEY: your key
# - SESSION_SECRET: openssl rand -hex 32
# - PUBSUB_VERIFICATION_TOKEN: openssl rand -hex 16
# - PUBSUB_TOPIC: projects/YOUR-GCP-PROJECT-ID/topics/gmail-triage
# - PUSH_NOTIFICATIONS_ENABLED: true
```

The `.env` file is loaded by Docker Compose and contains secrets — never commit it to git. It is already listed in `.gitignore`. The `SESSION_SECRET` protects user sessions; the `PUBSUB_VERIFICATION_TOKEN` is a shared secret that prevents anyone from triggering email processing by sending arbitrary POST requests to your push endpoint.

---

## Step 6: Start the app stack

```bash
docker compose up -d
docker compose logs -f app  # Watch for startup messages
```

This starts PostgreSQL and the Go app. The app runs database migrations automatically on startup — no separate migration step needed.

Expected logs:

```
✓ Database connected successfully
✓ Database migrations completed
✓ Gmail monitoring mode: push notifications
```

If you see database connection errors, wait a few seconds and check again — PostgreSQL may still be initialising on first run.

---

## Step 7: Start cloudflared

```bash
cloudflared tunnel run gmail-triage
```

Or install as a system service so it starts automatically on boot:

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Once cloudflared is running, your Pi is reachable at `https://your-hostname.your-domain.com`. The app cannot receive Gmail notifications until both the tunnel and the app are running — if either is down, push notifications will accumulate in Pub/Sub and be delivered once both are back up (within the subscription's retention window).

---

## Step 8: Create the Pub/Sub push subscription

The Pub/Sub topic (Step 4c) is a channel. The subscription tells Pub/Sub where to deliver messages — in this case, your app's `/api/gmail/push` endpoint. This step cannot be done before Step 7 because Pub/Sub will reject a push endpoint that does not respond correctly when the subscription is created.

The `?token=` parameter is the shared secret that prevents anyone else from triggering processing by POSTing to your endpoint.

```bash
gcloud pubsub subscriptions create gmail-triage-push \
  --topic=gmail-triage \
  --push-endpoint="https://your-hostname.your-domain.com/api/gmail/push?token=YOUR-PUBSUB-VERIFICATION-TOKEN" \
  --ack-deadline=30
```

Replace:
- `your-hostname.your-domain.com` — your tunnel hostname
- `YOUR-PUBSUB-VERIFICATION-TOKEN` — the exact value of `PUBSUB_VERIFICATION_TOKEN` in your `.env`

---

## Step 9: Sign in and verify

1. Visit `https://your-hostname.your-domain.com`
2. Click **Sign in with Google** and complete the OAuth flow
3. On sign-in, the app automatically calls `gmail.watch()` to register your inbox with the Pub/Sub topic
4. Send yourself a test email and check the Docker logs:

```bash
docker compose logs -f app
```

Expected: `Gmail push: notification for you@gmail.com` followed by processing logs.

---

## Step 10: Configure labels

1. Go to `/labels`
2. Add labels matching ones you use in Gmail (e.g. "Work", "Newsletters", "Receipts")
3. Add a description for each to help the AI decide when to apply it

The AI uses these descriptions when deciding which label to assign to each email. More specific descriptions produce more accurate labelling.

---

## Ongoing operations

### Redeploy after code changes

```bash
git pull
docker compose build
docker compose up -d
```

### Check logs

```bash
docker compose logs -f app      # App logs
docker compose logs -f db       # Database logs
journalctl -u cloudflared -f    # Tunnel logs
```

### Start/stop the app

```bash
docker compose down    # Stop
docker compose up -d   # Start
```

---

## Troubleshooting

### "redirect_uri_mismatch" on OAuth

The `GOOGLE_REDIRECT_URL` in `.env` must exactly match the URI you added in Google Cloud Console (Step 4b) — same protocol, domain, and path. Even a trailing slash difference will cause this error.

### Gmail push notifications not arriving

1. Check the Pub/Sub subscription push endpoint URL includes the correct `?token=` value
2. Run `docker compose logs app` and send yourself an email — look for "Gmail push: notification for..."
3. If nothing arrives, check the Pub/Sub subscription in Google Cloud Console — look at message backlog and push errors

### OAuth token expired / "failed to refresh token"

Users need to sign in again to get a new refresh token. This can happen if the app was offline for an extended period and the refresh token was revoked by Google.

### Tunnel not connecting

```bash
cloudflared tunnel run gmail-triage  # Run in foreground to see errors
```

Check that `~/.cloudflared/config.yml` has the correct tunnel ID and credentials file path.
