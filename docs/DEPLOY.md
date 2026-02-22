# Deployment Guide: Cloudflare Tunnel + Raspberry Pi

## Architecture

```
Browser → Cloudflare Edge (HTTPS) → cloudflared tunnel → Go app on Pi → PostgreSQL on Pi
```

The Go backend runs on your Raspberry Pi. `cloudflared` creates an outbound connection from the Pi to Cloudflare's network, giving the app a stable public HTTPS URL without port forwarding or a static IP. The browser connects to Cloudflare, which forwards traffic through the tunnel to the Pi.

**LAN access:** `http://raspberrypi.local:8080` (direct, no tunnel involved — requires `SERVER_HOST=0.0.0.0` in `.env`)
**Remote access:** via Cloudflare Tunnel public URL

---

## Prerequisites

- Raspberry Pi running Raspberry Pi OS (64-bit recommended)
- Docker and Docker Compose installed on the Pi
- Cloudflare account (free tier) with a domain added
- Google Cloud project with Gmail API enabled
- OpenAI API key

---

## Step 1: Install cloudflared on the Pi

`cloudflared` is the daemon that maintains the tunnel. It makes outbound connections to Cloudflare — no inbound ports or firewall rules needed.

```bash
# Install cloudflared (ARM64 for Pi 4/5)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo install cloudflared /usr/local/bin/
cloudflared --version

# Log in to your Cloudflare account (opens a browser)
cloudflared tunnel login

# Create a named tunnel (keeps the same URL across restarts)
cloudflared tunnel create gmail-triage
# Note the tunnel ID shown — you will need it in the next step
```

---

## Step 2: Configure the tunnel

Use `/etc/cloudflared` for config and credentials — it is accessible to the systemd service regardless of which user it runs as.

```bash
sudo mkdir -p /etc/cloudflared

# Copy example config from the repo
sudo cp deploy/cloudflare-tunnel.yml.example /etc/cloudflared/config.yml

# Copy the tunnel credentials file (created in Step 1)
sudo cp ~/.cloudflared/<TUNNEL-ID>.json /etc/cloudflared/

# Copy the login certificate
sudo cp ~/.cloudflared/cert.pem /etc/cloudflared/

# Edit the config
sudo nano /etc/cloudflared/config.yml
# - Replace YOUR-TUNNEL-ID with the tunnel ID from Step 1
# - Replace the credentials-file path with /etc/cloudflared/<TUNNEL-ID>.json
# - Replace your-hostname.your-domain.com with your desired subdomain
```

Your `/etc/cloudflared/` should contain:
```
/etc/cloudflared/config.yml
/etc/cloudflared/<TUNNEL-ID>.json
/etc/cloudflared/cert.pem
```

---

## Step 3: Create a DNS record for your tunnel

```bash
cloudflared tunnel route dns gmail-triage your-hostname.your-domain.com
```

This creates a CNAME in your Cloudflare DNS pointing your hostname to the tunnel.

---

## Step 4: Google OAuth setup

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/)
2. Enable **Gmail API**
3. Create **OAuth 2.0 Client ID** (Web application)
4. Authorized redirect URI: `https://your-hostname.your-domain.com/auth/callback`
5. Save the **Client ID** and **Client Secret**

---

## Step 5: Configure the app

```bash
cp .env.example .env
# Edit .env with your actual values:
# - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET from Step 4
# - GOOGLE_REDIRECT_URL: https://your-hostname.your-domain.com/auth/callback
# - OPENAI_API_KEY
# - SESSION_SECRET: openssl rand -hex 32
# - SERVER_HOST=0.0.0.0 (if you also want LAN access)
```

---

## Step 6: Start the app

```bash
docker compose up -d
docker compose logs -f app
```

Expected logs:
```
✓ Database connected successfully
✓ Database migrations completed
✓ Gmail monitoring mode: polling every 5m
```

---

## Step 7: Start cloudflared

Install as a system service so it starts automatically on boot:

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

To run in the foreground for debugging:
```bash
cloudflared tunnel --config /etc/cloudflared/config.yml run gmail-triage
```

Once running, your Pi is reachable at `https://your-hostname.your-domain.com`.

---

## Step 8: Sign in and verify

1. Visit `https://your-hostname.your-domain.com`
2. Click **Sign in with Google** and complete the OAuth flow
3. Go to `/labels` and add labels matching ones you use in Gmail
4. Send yourself a test email and check logs: `docker compose logs -f app`

---

## Ongoing operations

### Redeploy after code changes

```bash
git pull
docker compose build
docker compose up -d
```

Data is stored in a named Docker volume (`postgres_data`) and is not affected by redeployments.

### Check logs

```bash
docker compose logs -f app      # App logs
docker compose logs -f db       # Database logs
journalctl -u cloudflared -f    # Tunnel logs
```

---

## Troubleshooting

### "redirect_uri_mismatch" on OAuth

`GOOGLE_REDIRECT_URL` in `.env` must exactly match the URI in Google Cloud Console — same protocol, domain, and path. Even a trailing slash difference causes this error.

### Tunnel not connecting

```bash
cloudflared tunnel --config /etc/cloudflared/config.yml run gmail-triage
journalctl -u cloudflared -f
```

Check that `/etc/cloudflared/config.yml` has the correct tunnel ID, the `credentials-file` path points to `/etc/cloudflared/<TUNNEL-ID>.json`, and `cert.pem` is present.

### LAN access not working

Set `SERVER_HOST=0.0.0.0` in `.env` and change the `ports` binding in `docker-compose.yml` from `127.0.0.1:8080:8080` to `8080:8080`, then `docker compose up -d`.
