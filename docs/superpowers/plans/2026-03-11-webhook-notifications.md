# Webhook Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webhook as an alternate notification channel alongside Pushover, with richer JSON payload and an optional custom header.

**Architecture:** Mirror the Pushover pattern — new `webhook` package with `Client.Send()`, 3 new columns on `users` table, webhook fired in `processor.go` alongside Pushover. Settings UI extended with webhook section.

**Tech Stack:** Go (backend), PostgreSQL (migration), React + TypeScript + shadcn/ui (frontend)

**Spec:** `docs/superpowers/specs/2026-03-11-webhook-notifications-design.md`

---

## Chunk 1: Backend Core

### Task 1: Database migration

**Files:**
- Create: `internal/database/migrations/016_add_webhook_config.sql`

- [ ] **Step 1: Create migration file**

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_header_key TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_header_value TEXT DEFAULT '';
```

- [ ] **Step 2: Verify migration compiles**

Run: `go build ./...`
Expected: PASS (migrations are embedded via go:embed)

- [ ] **Step 3: Commit**

```bash
git add internal/database/migrations/016_add_webhook_config.sql
git commit -m "feat: add webhook config columns migration"
```

---

### Task 2: Add webhook fields to User model

**Files:**
- Modify: `internal/database/models.go:11-24` (User struct)

- [ ] **Step 1: Add 3 fields and helper to User struct**

Add after `PushoverAppToken` (line 21):

```go
WebhookURL         string     `db:"webhook_url" json:"-"`          // Webhook URL for notifications
WebhookHeaderKey   string     `db:"webhook_header_key" json:"-"`   // Optional custom header name
WebhookHeaderValue string     `db:"webhook_header_value" json:"-"` // Optional custom header value
```

Add after `HasPushoverConfig()` (line 49):

```go
// HasWebhookConfig returns true if the user has a webhook URL configured
func (u *User) HasWebhookConfig() bool {
	return u.WebhookURL != ""
}
```

- [ ] **Step 2: Verify build**

Run: `go build ./...`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/database/models.go
git commit -m "feat: add webhook fields and HasWebhookConfig to User model"
```

---

### Task 3: Update all user query functions

**Files:**
- Modify: `internal/database/users.go`

All 6 functions that SELECT user columns must include the 3 new webhook columns. The pattern for every SELECT query is to add `, webhook_url, webhook_header_key, webhook_header_value` to the column list and add `&user.WebhookURL, &user.WebhookHeaderKey, &user.WebhookHeaderValue` to the Scan call (before `&user.CreatedAt`).

- [ ] **Step 1: Update `CreateUser` (line 12)**

Change the INSERT query (line 25) to include the 3 new columns:

```go
query := `
    INSERT INTO users (email, google_id, access_token, refresh_token, token_expiry, is_active, pushover_user_key, pushover_app_token, webhook_url, webhook_header_key, webhook_header_value, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
`
```

Update the ExecContext args (line 30) to include:

```go
err := db.conn.QueryRowContext(
    ctx,
    query,
    user.Email,
    user.GoogleID,
    user.AccessToken,
    user.RefreshToken,
    user.TokenExpiry,
    user.IsActive,
    user.PushoverUserKey,
    user.PushoverAppToken,
    user.WebhookURL,
    user.WebhookHeaderKey,
    user.WebhookHeaderValue,
    user.CreatedAt,
    user.UpdatedAt,
).Scan(&user.ID)
```

- [ ] **Step 2: Update `GetUserByEmail` (line 53)**

Change query (line 57) to:

```go
query := `
    SELECT id, email, google_id, access_token, refresh_token, token_expiry, is_active, last_checked_at, pushover_user_key, pushover_app_token, webhook_url, webhook_header_key, webhook_header_value, created_at, updated_at
    FROM users
    WHERE email = $1
`
```

Add to Scan (after `&user.PushoverAppToken`):

```go
&user.WebhookURL,
&user.WebhookHeaderKey,
&user.WebhookHeaderValue,
```

- [ ] **Step 3: Update `GetUserByGoogleID` (line 85)**

Same pattern — add 3 columns to SELECT (line 89) and 3 fields to Scan (after `&user.PushoverAppToken`).

- [ ] **Step 4: Update `GetAllActiveUsers` (line 142)**

Add 3 columns to SELECT (line 144) and 3 fields to Scan (after `&user.PushoverAppToken`, line 169-170).

- [ ] **Step 5: Update `GetActiveUsers` (line 229)**

Add 3 columns to SELECT (line 231) and 3 fields to Scan (after `&user.PushoverAppToken`, line 255-256).

- [ ] **Step 6: Update `GetUserByID` (line 270)**

Add 3 columns to SELECT (line 274) and 3 fields to Scan (after `&user.PushoverAppToken`, line 289-290).

- [ ] **Step 7: Add `UpdateWebhookConfig` method**

Add after `UpdatePushoverConfig` (line 315):

```go
// UpdateWebhookConfig updates a user's webhook settings
func (db *DB) UpdateWebhookConfig(ctx context.Context, userID int64, url, headerKey, headerValue string) error {
	query := `
		UPDATE users
		SET webhook_url = $1, webhook_header_key = $2, webhook_header_value = $3, updated_at = $4
		WHERE id = $5
	`

	_, err := db.conn.ExecContext(ctx, query, url, headerKey, headerValue, time.Now(), userID)
	if err != nil {
		return fmt.Errorf("failed to update webhook config: %w", err)
	}

	return nil
}
```

- [ ] **Step 8: Verify build**

Run: `go build ./...`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add internal/database/users.go
git commit -m "feat: add webhook columns to all user queries and UpdateWebhookConfig"
```

---

### Task 4: Create webhook client package

**Files:**
- Create: `internal/webhook/client.go`

- [ ] **Step 1: Create the webhook client**

```go
package webhook

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Client sends webhook notifications
type Client struct {
	httpClient *http.Client
}

// Payload is the JSON body sent to the webhook URL
type Payload struct {
	Title         string   `json:"title"`
	Message       string   `json:"message"`
	FromAddress   string   `json:"from_address"`
	EmailID       string   `json:"email_id"`
	Slug          string   `json:"slug"`
	Subject       string   `json:"subject"`
	LabelsApplied []string `json:"labels_applied"`
	ProcessedAt   string   `json:"processed_at"`
}

// NewClient creates a new webhook client with a 10s timeout
func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Send POSTs the payload as JSON to the webhook URL.
// If headerKey is non-empty, the custom header is included.
func (c *Client) Send(webhookURL, headerKey, headerValue string, payload Payload) error {
	// Validate URL scheme
	parsed, err := url.Parse(webhookURL)
	if err != nil {
		return fmt.Errorf("invalid webhook URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("webhook URL must use http or https scheme, got %q", parsed.Scheme)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook payload: %w", err)
	}

	req, err := http.NewRequest("POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create webhook request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if headerKey != "" {
		req.Header.Set(headerKey, headerValue)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("webhook request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}
```

- [ ] **Step 2: Verify build**

Run: `go build ./...`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/webhook/client.go
git commit -m "feat: add webhook client package"
```

---

### Task 5: Wire webhook into pipeline

**Files:**
- Modify: `internal/pipeline/processor.go:1-32` (struct + constructor)
- Modify: `internal/pipeline/processor.go:145-167` (notification block)
- Modify: `cmd/server/main.go:14-92` (imports + initialization)

- [ ] **Step 1: Add webhook to Processor struct and constructor**

In `processor.go`, add import:

```go
"github.com/den/gmail-triage-assistant/internal/webhook"
```

Add field to `Processor` struct (line 18):

```go
type Processor struct {
	db          *database.DB
	openai      *openai.Client
	oauthConfig *oauth2.Config
	pushover    *pushover.Client
	webhook     *webhook.Client
}
```

Update `NewProcessor` (line 25):

```go
func NewProcessor(db *database.DB, openaiClient *openai.Client, oauthConfig *oauth2.Config, pushoverClient *pushover.Client, webhookClient *webhook.Client) *Processor {
	return &Processor{
		db:          db,
		openai:      openaiClient,
		oauthConfig: oauthConfig,
		pushover:    pushoverClient,
		webhook:     webhookClient,
	}
}
```

- [ ] **Step 2: Add webhook notification block after Pushover block**

After the closing brace of the Pushover block (line 167), before `// Save to database` (line 169), add:

```go
	// Send webhook notification if AI provided a notification message and user has webhook configured
	if actions.NotificationMessage != "" && user.HasWebhookConfig() {
		payload := webhook.Payload{
			Title:         message.Subject,
			Message:       actions.NotificationMessage,
			FromAddress:   message.From,
			EmailID:       message.ID,
			Slug:          analysis.Slug,
			Subject:       message.Subject,
			LabelsApplied: actions.Labels,
			ProcessedAt:   time.Now().UTC().Format(time.RFC3339),
		}
		if err := p.webhook.Send(user.WebhookURL, user.WebhookHeaderKey, user.WebhookHeaderValue, payload); err != nil {
			log.Printf("[%s] Failed to send webhook notification: %v", user.Email, err)
		} else {
			notificationSent = true
			log.Printf("[%s] Webhook notification sent for: %s", user.Email, message.Subject)
		}
	}
```

- [ ] **Step 3: Update `main.go` to initialize and wire webhook client**

Add import:

```go
"github.com/den/gmail-triage-assistant/internal/webhook"
```

After the Pushover client initialization (line 88-89), add:

```go
// Initialize webhook client for webhook notifications
webhookClient := webhook.NewClient()
log.Printf("✓ Webhook client initialized")
```

Update the processor initialization (line 92):

```go
processor := pipeline.NewProcessor(db, openaiClient, oauthConfig, pushoverClient, webhookClient)
```

- [ ] **Step 4: Verify build**

Run: `go build ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/pipeline/processor.go cmd/server/main.go
git commit -m "feat: wire webhook client into email processing pipeline"
```

---

## Chunk 2: API & Frontend

### Task 6: Add webhook API endpoints

**Files:**
- Modify: `internal/web/api_handlers.go:324-374` (settings + new handler)
- Modify: `internal/web/server.go:101-102` (route registration)

- [ ] **Step 1: Extend `handleAPIGetSettings` response**

In `api_handlers.go`, replace the response block in `handleAPIGetSettings` (lines 336-349) with:

```go
	// Mask the pushover user key for display (show last 4 chars)
	maskedKey := ""
	if user.PushoverUserKey != "" {
		if len(user.PushoverUserKey) > 4 {
			maskedKey = "****" + user.PushoverUserKey[len(user.PushoverUserKey)-4:]
		} else {
			maskedKey = "****"
		}
	}

	// Mask the webhook header value for display (show last 4 chars)
	maskedHeaderValue := ""
	if user.WebhookHeaderValue != "" {
		if len(user.WebhookHeaderValue) > 4 {
			maskedHeaderValue = "****" + user.WebhookHeaderValue[len(user.WebhookHeaderValue)-4:]
		} else {
			maskedHeaderValue = "****"
		}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"pushover_user_key":    maskedKey,
		"pushover_configured":  user.HasPushoverConfig(),
		"webhook_url":          user.WebhookURL,
		"webhook_header_key":   user.WebhookHeaderKey,
		"webhook_header_value": maskedHeaderValue,
		"webhook_configured":   user.HasWebhookConfig(),
	})
```

- [ ] **Step 2: Add `handleAPIUpdateWebhook` handler**

Add after `handleAPIUpdatePushover` (after line 374):

```go
// PUT /api/v1/settings/webhook
func (s *Server) handleAPIUpdateWebhook(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	var body struct {
		URL         string `json:"url"`
		HeaderKey   string `json:"header_key"`
		HeaderValue string `json:"header_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	ctx := context.Background()
	if err := s.db.UpdateWebhookConfig(ctx, userID, body.URL, body.HeaderKey, body.HeaderValue); err != nil {
		log.Printf("API: Failed to update webhook config: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to save webhook settings")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
```

- [ ] **Step 3: Register the route**

In `server.go`, after the pushover settings route (line 102), add:

```go
api.HandleFunc("/settings/webhook", s.requireAuthAPI(s.handleAPIUpdateWebhook)).Methods("PUT")
```

- [ ] **Step 4: Verify build**

Run: `go build ./... && go vet ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/web/api_handlers.go internal/web/server.go
git commit -m "feat: add webhook settings API endpoints"
```

---

### Task 7: Add frontend types and API methods

**Files:**
- Modify: `frontend/src/lib/types.ts:87-91` (UserSettings interface)
- Modify: `frontend/src/lib/api.ts` (add updateWebhook method)

- [ ] **Step 1: Extend `UserSettings` interface**

In `types.ts`, replace the `UserSettings` interface (lines 87-91) with:

```typescript
export interface UserSettings {
  pushover_user_key: string;
  pushover_configured: boolean;
  webhook_url: string;
  webhook_header_key: string;
  webhook_header_value: string;
  webhook_configured: boolean;
}
```

- [ ] **Step 2: Add `updateWebhook` API method**

In `api.ts`, after `updatePushover` (line 101), add:

```typescript
  updateWebhook: (url: string, header_key: string, header_value: string) =>
    request<{ status: string }>("/settings/webhook", {
      method: "PUT",
      body: JSON.stringify({ url, header_key, header_value }),
    }),
```

- [ ] **Step 3: Verify frontend build**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat: add webhook types and API method to frontend"
```

---

### Task 8: Add webhook section to settings page

**Files:**
- Modify: `frontend/src/pages/settings.tsx`

- [ ] **Step 1: Add webhook state variables**

After the existing Pushover state variables (lines 12-14), add:

```typescript
const [webhookUrl, setWebhookUrl] = useState("");
const [webhookHeaderKey, setWebhookHeaderKey] = useState("");
const [webhookHeaderValue, setWebhookHeaderValue] = useState("");
const [webhookSaving, setWebhookSaving] = useState(false);
const [webhookMessage, setWebhookMessage] = useState("");
```

- [ ] **Step 2: Add webhook save and clear handlers**

After `handleClear` (line 65), add:

```typescript
const handleWebhookSave = async () => {
  setWebhookSaving(true);
  setWebhookMessage("");
  try {
    await api.updateWebhook(webhookUrl, webhookHeaderKey, webhookHeaderValue);
    setWebhookMessage("Webhook settings saved successfully.");
    setWebhookUrl("");
    setWebhookHeaderKey("");
    setWebhookHeaderValue("");
    const updated = await api.getSettings();
    setSettings(updated);
  } catch (err) {
    setWebhookMessage("Failed to save webhook settings.");
  } finally {
    setWebhookSaving(false);
  }
};

const handleWebhookClear = async () => {
  setWebhookSaving(true);
  setWebhookMessage("");
  try {
    await api.updateWebhook("", "", "");
    setWebhookMessage("Webhook settings cleared.");
    const updated = await api.getSettings();
    setSettings(updated);
  } catch (err) {
    setWebhookMessage("Failed to clear webhook settings.");
  } finally {
    setWebhookSaving(false);
  }
};
```

- [ ] **Step 3: Add webhook Card to the JSX**

After the closing `</Card>` of the Pushover section (line 170), before the Data Export Card (line 172), add:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Webhook Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure a webhook URL to receive JSON notifications for important
            emails. Optionally include a custom header for authentication.
          </p>

          {settings?.webhook_configured && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              Webhook is configured ({settings.webhook_url}).
              {settings.webhook_header_key && (
                <> Header: {settings.webhook_header_key} = {settings.webhook_header_value}</>
              )}
              {" "}Enter new settings below to update, or clear to disable.
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Webhook URL</label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/webhook"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Header Key <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={webhookHeaderKey}
              onChange={(e) => setWebhookHeaderKey(e.target.value)}
              placeholder="e.g. Authorization, X-Api-Key"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Header Value <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={webhookHeaderValue}
              onChange={(e) => setWebhookHeaderValue(e.target.value)}
              placeholder="e.g. Bearer your-token"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleWebhookSave}
              disabled={webhookSaving || !webhookUrl}
            >
              {webhookSaving ? "Saving..." : "Save"}
            </Button>
            {settings?.webhook_configured && (
              <Button variant="outline" onClick={handleWebhookClear} disabled={webhookSaving}>
                Clear
              </Button>
            )}
          </div>

          {webhookMessage && (
            <p className="text-sm text-muted-foreground">{webhookMessage}</p>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: Verify frontend build**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 5: Verify Go build still passes**

Run: `go build ./... && go vet ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/settings.tsx
git commit -m "feat: add webhook notification settings to UI"
```
