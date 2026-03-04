# Sender Profiles - Design Document

## Table of Contents
1. [Database Schema](#1-database-schema)
2. [Go Models](#2-go-models)
3. [Database Layer](#3-database-layer)
4. [OpenAI Client Extensions](#4-openai-client-extensions)
5. [Pipeline Integration](#5-pipeline-integration)
6. [Scheduler Integration](#6-scheduler-integration)
7. [Data Flow](#7-data-flow)

---

## 1. Database Schema

### Migration: `011_add_sender_profiles.sql`

Single table with a `profile_type` discriminator. Sender profiles and domain profiles share the same structure but have different semantics.

```sql
CREATE TABLE sender_profiles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL CHECK (profile_type IN ('sender', 'domain')),
    identifier TEXT NOT NULL,  -- email address for 'sender', domain for 'domain'

    -- Raw counters (derive rates and top-N in application code)
    email_count INT NOT NULL DEFAULT 0,
    emails_archived INT NOT NULL DEFAULT 0,
    emails_notified INT NOT NULL DEFAULT 0,
    slug_counts JSONB NOT NULL DEFAULT '{}',      -- {"marketing_newsletter": 15, "invoice_due": 3}
    label_counts JSONB NOT NULL DEFAULT '{}',     -- {"Finance": 10, "Urgent": 2}
    keyword_counts JSONB NOT NULL DEFAULT '{}',   -- {"invoice": 8, "payment": 5}

    -- AI-classified
    sender_type TEXT NOT NULL DEFAULT '',          -- human, newsletter, automated, marketing, notification

    -- AI narrative (evolved incrementally)
    summary TEXT NOT NULL DEFAULT '',

    -- Timestamps
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_sender_profiles_lookup ON sender_profiles(user_id, profile_type, identifier);
CREATE INDEX idx_sender_profiles_stale ON sender_profiles(modified_at);
```

**Design rationale:**
- **Single table** with `profile_type` — sender and domain profiles are structurally identical, just keyed differently. One table simplifies queries, migrations, and the Go layer.
- **Raw counters** (`slug_counts`, `label_counts`, `keyword_counts`) instead of pre-computed top-N arrays. Incrementing a counter is trivial; computing top-5 happens in Go when formatting for prompts. No complex update-and-resort logic needed.
- **`emails_archived` / `emails_notified`** — derive bypass and notification rates as `emails_archived / email_count`. Avoids floating-point drift from incremental rate calculations.
- **Unique index** on `(user_id, profile_type, identifier)` — supports efficient lookup and prevents duplicates.

---

## 2. Go Models

### Add to `internal/database/models.go`

```go
// SenderProfile stores intelligence about an email sender or domain
type SenderProfile struct {
    ID             int64             `db:"id" json:"id"`
    UserID         int64             `db:"user_id" json:"user_id"`
    ProfileType    ProfileType       `db:"profile_type" json:"profile_type"` // "sender" or "domain"
    Identifier     string            `db:"identifier" json:"identifier"`     // email address or domain

    EmailCount     int               `db:"email_count" json:"email_count"`
    EmailsArchived int               `db:"emails_archived" json:"emails_archived"`
    EmailsNotified int               `db:"emails_notified" json:"emails_notified"`
    SlugCounts     map[string]int    `db:"slug_counts" json:"slug_counts"`
    LabelCounts    map[string]int    `db:"label_counts" json:"label_counts"`
    KeywordCounts  map[string]int    `db:"keyword_counts" json:"keyword_counts"`

    SenderType     string            `db:"sender_type" json:"sender_type"`
    Summary        string            `db:"summary" json:"summary"`

    FirstSeenAt    time.Time         `db:"first_seen_at" json:"first_seen_at"`
    LastSeenAt     time.Time         `db:"last_seen_at" json:"last_seen_at"`
    ModifiedAt     time.Time         `db:"modified_at" json:"modified_at"`
    CreatedAt      time.Time         `db:"created_at" json:"created_at"`
}

type ProfileType string

const (
    ProfileTypeSender ProfileType = "sender"
    ProfileTypeDomain ProfileType = "domain"
)
```

### Helper methods on SenderProfile

```go
// TopSlugs returns the top N slugs by count
func (p *SenderProfile) TopSlugs(n int) []string { ... }

// TopLabels returns the top N labels by count
func (p *SenderProfile) TopLabels(n int) []string { ... }

// TopKeywords returns the top N keywords by count
func (p *SenderProfile) TopKeywords(n int) []string { ... }

// BypassInboxRate returns the percentage of emails archived
func (p *SenderProfile) BypassInboxRate() float64 {
    if p.EmailCount == 0 { return 0 }
    return float64(p.EmailsArchived) / float64(p.EmailCount)
}

// NotificationRate returns the percentage of emails that triggered notifications
func (p *SenderProfile) NotificationRate() float64 {
    if p.EmailCount == 0 { return 0 }
    return float64(p.EmailsNotified) / float64(p.EmailCount)
}

// FormatForPrompt produces a human-readable summary for AI context
func (p *SenderProfile) FormatForPrompt() string { ... }
```

### Ignored domains constant

```go
var IgnoredDomains = map[string]bool{
    "gmail.com": true, "googlemail.com": true,
    "hotmail.com": true, "outlook.com": true, "live.com": true,
    "yahoo.com": true, "yahoo.co.uk": true, "aol.com": true,
    "icloud.com": true, "me.com": true, "mac.com": true,
    "protonmail.com": true, "proton.me": true,
    "zoho.com": true, "mail.com": true,
    "gmx.com": true, "gmx.net": true,
    "yandex.com": true, "tutanota.com": true, "fastmail.com": true,
}

func IsIgnoredDomain(domain string) bool {
    return IgnoredDomains[strings.ToLower(domain)]
}

func ExtractDomain(email string) string {
    if i := strings.LastIndex(email, "@"); i >= 0 {
        return strings.ToLower(email[i+1:])
    }
    return ""
}
```

---

## 3. Database Layer

### New file: `internal/database/sender_profiles.go`

#### Core CRUD

```go
// GetSenderProfile returns a profile by type and identifier, or nil if not found
func (db *DB) GetSenderProfile(ctx context.Context, userID int64, profileType ProfileType, identifier string) (*SenderProfile, error)

// UpsertSenderProfile creates or updates a profile (uses ON CONFLICT)
func (db *DB) UpsertSenderProfile(ctx context.Context, profile *SenderProfile) error

// DeleteStaleProfiles removes profiles not modified in over 1 year
func (db *DB) DeleteStaleProfiles(ctx context.Context) (int64, error)
```

#### Bootstrap queries

```go
// GetHistoricalEmailsFromAddress returns last N emails from a specific address
func (db *DB) GetHistoricalEmailsFromAddress(ctx context.Context, userID int64, address string, limit int) ([]*Email, error)

// GetHistoricalEmailsFromDomain returns last N emails from any address at a domain
func (db *DB) GetHistoricalEmailsFromDomain(ctx context.Context, userID int64, domain string, limit int) ([]*Email, error)
```

#### Key SQL patterns

**Upsert (create or update):**
```sql
INSERT INTO sender_profiles (user_id, profile_type, identifier, email_count, ...)
VALUES ($1, $2, $3, $4, ...)
ON CONFLICT (user_id, profile_type, identifier)
DO UPDATE SET
    email_count = EXCLUDED.email_count,
    slug_counts = EXCLUDED.slug_counts,
    ...
    modified_at = NOW()
```

**Domain email lookup** (for bootstrap):
```sql
SELECT id, from_address, subject, slug, keywords, summary,
       labels_applied, bypassed_inbox, reasoning, processed_at
FROM emails
WHERE user_id = $1 AND from_address LIKE '%@' || $2
ORDER BY processed_at DESC
LIMIT $3
```

**Stale cleanup:**
```sql
DELETE FROM sender_profiles
WHERE modified_at < NOW() - INTERVAL '1 year'
```

---

## 4. OpenAI Client Extensions

### New file: `internal/openai/profiles.go`

Three new AI operations, all using `GenerateMemory` (unstructured text) since profiles are narrative-heavy:

#### 4a. Bootstrap profile from history

```go
func (c *Client) BootstrapSenderProfile(ctx context.Context, identifier string, emails []*database.Email) (*BootstrapResult, error)
```

**System prompt:**
```
You are analyzing historical emails to create a sender profile.

Given the email history below, produce a JSON response:
{
  "sender_type": "human|newsletter|automated|marketing|notification",
  "summary": "2-3 sentence description of who this sender is, what they typically send, and how their emails should be handled"
}
```

**User prompt:** Formatted list of historical emails showing from, subject, slug, labels applied, archived status.

**Response format:** JSON schema with `sender_type` (string) and `summary` (string). Structured fields (slug counts, label counts, etc.) are computed directly from the historical email data in Go — no need for the AI to count.

#### 4b. Evolve profile summary

```go
func (c *Client) EvolveProfileSummary(ctx context.Context, currentSummary string, senderType string, newEmail *ProfileUpdateContext) (string, error)
```

**System prompt:**
```
You are updating a sender profile. Given the current profile summary and a new email outcome, produce an updated summary.

Rules:
- Reinforce patterns that continue
- Note any changes in behavior
- Keep it to 2-3 sentences max
- Update sender_type classification if behavior has clearly shifted

Respond with JSON: {"sender_type": "...", "summary": "..."}
```

**User prompt:** Current summary + sender_type + new email's slug/labels/archived/summary.

#### 4c. Profile context struct (for formatting)

```go
// ProfileUpdateContext carries the outcome of processing one email
type ProfileUpdateContext struct {
    From       string
    Subject    string
    Slug       string
    Keywords   []string
    Labels     []string
    Archived   bool
    Notified   bool
    Summary    string
}
```

### Existing method changes

**`AnalyzeEmail`** — add `senderContext string` parameter. This replaces the current `pastSlugs []string`. The sender context is a pre-formatted string containing both the sender and domain profile summaries.

Before:
```go
func (c *Client) AnalyzeEmail(ctx, from, subject, body string, pastSlugs []string, customSystemPrompt string) (*EmailAnalysis, error)
```

After:
```go
func (c *Client) AnalyzeEmail(ctx, from, subject, body string, senderContext string, customSystemPrompt string) (*EmailAnalysis, error)
```

The `senderContext` string is injected into the user prompt where `pastSlugs` currently goes.

**`DetermineActions`** — add `senderContext string` parameter. Injected into the user prompt alongside memory context.

Before:
```go
func (c *Client) DetermineActions(ctx, from, subject, slug string, keywords []string, summary string, labelNames []string, formattedLabels string, memoryContext string, customSystemPrompt string) (*EmailActions, error)
```

After:
```go
func (c *Client) DetermineActions(ctx, from, subject, slug string, keywords []string, summary string, labelNames []string, formattedLabels string, senderContext string, memoryContext string, customSystemPrompt string) (*EmailActions, error)
```

---

## 5. Pipeline Integration

### Modified `ProcessEmail` flow

The pipeline (`processor.go`) gains a new section between prompt loading and Stage 1. The profile loading/bootstrap and post-processing update are extracted into helper methods on `Processor`.

```
ProcessEmail(ctx, user, message)
│
├─ Decode body, truncate
├─ Load custom prompts + AI prompt supplements
├─ Load memory context
│
├─ NEW: Load/bootstrap sender profiles
│   ├─ domain = ExtractDomain(message.From)
│   ├─ senderProfile = loadOrBootstrap(user.ID, "sender", message.From, domain)
│   ├─ if !IsIgnoredDomain(domain):
│   │   domainProfile = loadOrBootstrap(user.ID, "domain", domain, domain)
│   └─ senderContext = formatProfilesForPrompt(senderProfile, domainProfile)
│
├─ Stage 1: AnalyzeEmail(..., senderContext, ...)  ← replaces pastSlugs
├─ Stage 2: DetermineActions(..., senderContext, memoryContext, ...)
│
├─ Save email to database
├─ Apply Gmail actions
│
└─ NEW: Update sender profiles
    ├─ updateProfile(senderProfile, analysis, actions)
    ├─ if domainProfile: updateProfile(domainProfile, analysis, actions)
    ├─ Evolve summaries via AI (sender + domain if applicable)
    └─ Upsert both profiles
```

### New processor methods

```go
// loadOrBootstrapProfile fetches an existing profile or creates one from history
func (p *Processor) loadOrBootstrapProfile(ctx context.Context, userID int64, profileType database.ProfileType, identifier string, domain string) *database.SenderProfile

// bootstrapProfile creates a new profile from historical emails
func (p *Processor) bootstrapProfile(ctx context.Context, userID int64, profileType database.ProfileType, identifier string, domain string) *database.SenderProfile

// updateProfileAfterProcessing increments counters and evolves summary
func (p *Processor) updateProfileAfterProcessing(ctx context.Context, profile *database.SenderProfile, analysis *openai.EmailAnalysis, actions *openai.EmailActions) error

// formatProfilesForPrompt creates the sender context string for AI prompts
func (p *Processor) formatProfilesForPrompt(sender *database.SenderProfile, domain *database.SenderProfile) string
```

### Profile context format (injected into prompts)

```
**Sender Profile** (john@example.com):
Type: newsletter | Emails seen: 47 | Archive rate: 85%
Top slugs: marketing_newsletter (30), product_update (12), promo_offer (5)
Top labels: Marketing (35), Newsletters (12)
Summary: Regular marketing sender from Example Corp. Sends weekly newsletters
and occasional promotional offers. Almost always archived, rarely needs attention.

**Domain Profile** (example.com):
Type: automated | Emails seen: 120 | Archive rate: 72%
Top slugs: marketing_newsletter (30), account_notification (25), invoice_receipt (20)
Summary: Example Corp sends a mix of marketing, account notifications, and
billing. Marketing is typically archived; account and billing emails are kept.
```

---

## 6. Scheduler Integration

### Stale profile cleanup

Add to `scheduler.go` — piggyback on the daily evening tasks (5PM) since it's lightweight:

```go
func (s *Scheduler) runEveningTasks(ctx context.Context) {
    // ... existing wrapup and memory logic ...

    // Cleanup stale profiles (runs daily, only deletes if > 1 year old)
    deleted, err := s.db.DeleteStaleProfiles(ctx)
    if err != nil {
        log.Printf("Error cleaning up stale profiles: %v", err)
    } else if deleted > 0 {
        log.Printf("🧹 Cleaned up %d stale sender profiles", deleted)
    }
}
```

No need for a separate scheduled slot — the DELETE query is fast and idempotent.

---

## 7. Data Flow

### First email from new sender (bootstrap path)

```
Email arrives from john@example.com
│
├─ GetSenderProfile(userID, "sender", "john@example.com") → nil (not found)
│   ├─ GetHistoricalEmailsFromAddress(userID, "john@example.com", 25) → [12 emails]
│   ├─ Compute slug_counts, label_counts, keyword_counts from historical data
│   ├─ BootstrapSenderProfile("john@example.com", historicalEmails) → {sender_type, summary}
│   └─ UpsertSenderProfile(new profile with computed counters + AI summary)
│
├─ domain = "example.com" (not ignored)
├─ GetSenderProfile(userID, "domain", "example.com") → nil (not found)
│   ├─ GetHistoricalEmailsFromDomain(userID, "example.com", 25) → [45 emails]
│   ├─ Compute counters from historical data
│   ├─ BootstrapSenderProfile("example.com", historicalEmails) → {sender_type, summary}
│   └─ UpsertSenderProfile(new domain profile)
│
├─ Format profiles → senderContext string
├─ Stage 1 with senderContext → analysis
├─ Stage 2 with senderContext → actions
├─ Save email, apply Gmail actions
│
└─ Update both profiles (increment counters, evolve summaries)
```

### Subsequent email from known sender (fast path)

```
Email arrives from john@example.com
│
├─ GetSenderProfile(userID, "sender", "john@example.com") → existing profile ✓
├─ GetSenderProfile(userID, "domain", "example.com") → existing profile ✓
├─ Format profiles → senderContext string
├─ Stage 1 → analysis
├─ Stage 2 → actions
├─ Save email, apply Gmail actions
│
└─ Update both profiles (increment counters, evolve summaries)
```

### Email from free email provider

```
Email arrives from alice@gmail.com
│
├─ GetSenderProfile(userID, "sender", "alice@gmail.com") → load or bootstrap
├─ domain = "gmail.com" → IsIgnoredDomain() = true → skip domain profile
├─ senderContext includes only sender profile (no domain)
├─ Stage 1 → Stage 2 → save → Gmail actions
│
└─ Update sender profile only
```

---

## API Cost Analysis

**Per email (known sender, known domain):**
- Existing: 2 AI calls (Stage 1 + Stage 2)
- New: 4 AI calls (Stage 1 + Stage 2 + evolve sender summary + evolve domain summary)
- The evolution calls use the same `GenerateMemory` path (simple text completion, ~200 tokens each)
- For ignored domains: 3 AI calls (no domain summary to evolve)

**Per new sender (bootstrap):**
- +1 AI call for sender bootstrap
- +1 AI call for domain bootstrap (if domain also new and not ignored)
- One-time cost; amortized across all future emails

**Mitigation:** The evolution calls are very small (short prompt, short response). Could defer to batch processing if cost becomes a concern, but per-email evolution was the chosen approach.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `internal/database/migrations/011_add_sender_profiles.sql` | Create | Schema migration |
| `internal/database/models.go` | Modify | Add SenderProfile, ProfileType, IgnoredDomains |
| `internal/database/sender_profiles.go` | Create | CRUD, bootstrap queries, stale cleanup |
| `internal/openai/profiles.go` | Create | Bootstrap and evolve AI calls |
| `internal/openai/client.go` | Modify | Update AnalyzeEmail and DetermineActions signatures |
| `internal/pipeline/processor.go` | Modify | Load/bootstrap profiles, pass to stages, update after |
| `internal/scheduler/scheduler.go` | Modify | Add stale cleanup to evening tasks |
