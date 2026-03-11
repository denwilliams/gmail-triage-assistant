# Webhook Notifications

## Summary

Add webhook as an alternate notification channel alongside Pushover. Fires on the same events (when AI determines a notification is warranted). Sends a JSON POST with richer payload than Pushover. Supports an optional custom header for authentication. Fire-and-forget with a single attempt, no retries — same as Pushover.

## Webhook Payload

POST JSON to user-configured URL:

```json
{
  "title": "Your invoice is overdue",
  "message": "<AI-generated notification message>",
  "from_address": "billing@powerco.com",
  "email_id": "18f3a2b...",
  "slug": "invoice_due_reminder",
  "subject": "Your invoice is overdue",
  "labels_applied": ["Finance", "Urgent"],
  "processed_at": "2026-03-11T14:30:00Z"
}
```

If the user configured a custom header (key + value), it's included in the request. If not, the POST is sent without it.

## Database

### Migration: `016_add_webhook_config.sql`

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_header_key TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_header_value TEXT DEFAULT '';
```

## Files to Change

### 1. New: `internal/webhook/client.go`

```go
type Client struct {
    httpClient *http.Client // 10s timeout
}

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

func NewClient() *Client
func (c *Client) Send(url, headerKey, headerValue string, payload Payload) error
```

- `Send` POSTs JSON to `url`, sets `Content-Type: application/json`
- If `headerKey != ""`, adds the custom header
- Returns error on non-2xx or network failure
- URL validation: only allow `http` and `https` schemes

### 2. Edit: `internal/database/models.go`

Add to `User` struct:

```go
WebhookURL         string `db:"webhook_url" json:"-"`
WebhookHeaderKey   string `db:"webhook_header_key" json:"-"`
WebhookHeaderValue string `db:"webhook_header_value" json:"-"`
```

Add helper:

```go
func (u *User) HasWebhookConfig() bool {
    return u.WebhookURL != ""
}
```

### 3. Edit: `internal/database/users.go`

Add `UpdateWebhookConfig(ctx, userID, url, headerKey, headerValue)` method. Same pattern as `UpdatePushoverConfig`.

Update **all** user query functions to include the 3 new columns in SELECT and Scan:
- `GetUserByID`
- `GetUserByEmail`
- `GetUserByGoogleID`
- `GetAllActiveUsers`
- `GetActiveUsers`
- `CreateUser` (INSERT RETURNING)

### 4. Edit: `internal/pipeline/processor.go`

Add `webhook *webhook.Client` field to `Processor` struct and update `NewProcessor` signature.

After the Pushover notification block, add webhook block. Set `notificationSent = true` if **either** Pushover or webhook succeeds. The `Notification` database record is written once if any channel succeeds (not per-channel), keeping the existing behavior where one notification record = one event.

```go
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

### 5. Edit: `cmd/server/main.go`

Initialize `webhook.NewClient()`, pass to `pipeline.NewProcessor()`.

### 6. Edit: `internal/web/api_handlers.go`

**Extend `handleAPIGetSettings`** response to include:

```go
"webhook_url":        user.WebhookURL,
"webhook_header_key": user.WebhookHeaderKey,     // not sensitive, just the header name
"webhook_header_value": maskedWebhookHeaderValue, // mask like pushover key (show last 4 chars)
"webhook_configured": user.HasWebhookConfig(),
```

Note: The header **key** (e.g. `Authorization`, `X-Api-Key`) is not sensitive and is returned as-is. The header **value** (e.g. `Bearer sk-abc123`) is the secret and gets masked.

**Add `handleAPIUpdateWebhook`** handler:

```go
func (s *Server) handleAPIUpdateWebhook(w http.ResponseWriter, r *http.Request) {
    // Parse body: {url, header_key, header_value}
    // Call db.UpdateWebhookConfig()
}
```

### 7. Edit: `internal/web/server.go`

Add route:

```go
api.HandleFunc("/settings/webhook", s.requireAuthAPI(s.handleAPIUpdateWebhook)).Methods("PUT")
```

### 8. Edit: `frontend/src/lib/types.ts`

Extend `UserSettings`:

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

### 9. Edit: `frontend/src/lib/api.ts`

Add:

```typescript
updateWebhook: (url: string, header_key: string, header_value: string) =>
    request<{ status: string }>("/settings/webhook", {
        method: "PUT",
        body: JSON.stringify({ url, header_key, header_value }),
    }),
```

### 10. Edit: `frontend/src/pages/settings.tsx`

Add Webhook section below Pushover. Fields: URL (required), Header Key (optional), Header Value (optional). Save and Clear buttons. Same UX pattern as Pushover. Show masked header value when configured.

## Verification

1. `go build ./...` + `go vet ./...`
2. `cd frontend && npm run build`
3. Configure webhook URL in settings, verify save/clear works
4. Trigger a notification-worthy email, verify webhook fires with correct payload
5. Configure with custom header, verify header appears in request
6. Configure without header, verify POST still works
7. Verify Pushover still works independently
