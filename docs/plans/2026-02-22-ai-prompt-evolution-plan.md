# AI-Written Prompt Evolution - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AI-generated prompts that evolve weekly and get appended to user-written system prompts during email processing.

**Architecture:** New `ai_prompts` table with versioned rows. After weekly memory generation, the system generates new versions of two AI prompts (`email_analyze`, `email_actions`) using the user prompt + previous AI prompt + weekly memory as inputs. During email processing, the AI prompt is appended to the user prompt.

**Tech Stack:** Go, PostgreSQL, OpenAI API (existing patterns)

---

### Task 1: Database Migration

**Files:**
- Create: `internal/database/migrations/008_add_ai_prompts.sql`

**Step 1: Create migration file**

```sql
CREATE TABLE ai_prompts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('email_analyze', 'email_actions')),
    content TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_prompts_user_type_version ON ai_prompts(user_id, type, version DESC);
```

**Step 2: Verify it compiles**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors (migration is embedded via `//go:embed`)

**Step 3: Commit**

```bash
git add internal/database/migrations/008_add_ai_prompts.sql
git commit -m "feat: add ai_prompts table migration"
```

---

### Task 2: Model and Type Definitions

**Files:**
- Modify: `internal/database/models.go`

**Step 1: Add AIPrompt model and AIPromptType**

Add after the `Memory` / `MemoryType` block (after line 89):

```go
// AIPrompt stores AI-generated prompt supplements that evolve over time
type AIPrompt struct {
	ID        int64        `db:"id" json:"id"`
	UserID    int64        `db:"user_id" json:"user_id"`
	Type      AIPromptType `db:"type" json:"type"`
	Content   string       `db:"content" json:"content"`
	Version   int          `db:"version" json:"version"`
	CreatedAt time.Time    `db:"created_at" json:"created_at"`
}

type AIPromptType string

const (
	AIPromptTypeEmailAnalyze AIPromptType = "email_analyze"
	AIPromptTypeEmailActions AIPromptType = "email_actions"
)
```

**Step 2: Verify it compiles**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add internal/database/models.go
git commit -m "feat: add AIPrompt model and type constants"
```

---

### Task 3: Database CRUD Operations

**Files:**
- Create: `internal/database/ai_prompts.go`

**Step 1: Create ai_prompts.go with three functions**

```go
package database

import (
	"context"
	"fmt"
)

// GetLatestAIPrompt retrieves the most recent AI prompt of a given type for a user.
// Returns nil, nil if no AI prompt exists yet.
func (db *DB) GetLatestAIPrompt(ctx context.Context, userID int64, promptType AIPromptType) (*AIPrompt, error) {
	query := `
		SELECT id, user_id, type, content, version, created_at
		FROM ai_prompts
		WHERE user_id = $1 AND type = $2
		ORDER BY version DESC
		LIMIT 1
	`

	var prompt AIPrompt
	err := db.conn.QueryRowContext(ctx, query, userID, promptType).Scan(
		&prompt.ID,
		&prompt.UserID,
		&prompt.Type,
		&prompt.Content,
		&prompt.Version,
		&prompt.CreatedAt,
	)

	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get latest AI prompt: %w", err)
	}

	return &prompt, nil
}

// CreateAIPrompt inserts a new AI prompt version. It auto-increments the version
// based on the current max version for this user+type.
func (db *DB) CreateAIPrompt(ctx context.Context, prompt *AIPrompt) error {
	query := `
		INSERT INTO ai_prompts (user_id, type, content, version, created_at)
		VALUES ($1, $2, $3, COALESCE((
			SELECT MAX(version) FROM ai_prompts WHERE user_id = $1 AND type = $2
		), 0) + 1, NOW())
		RETURNING id, version
	`

	err := db.conn.QueryRowContext(
		ctx,
		query,
		prompt.UserID,
		prompt.Type,
		prompt.Content,
	).Scan(&prompt.ID, &prompt.Version)

	if err != nil {
		return fmt.Errorf("failed to create AI prompt: %w", err)
	}

	return nil
}

// GetAIPromptHistory retrieves all versions of an AI prompt type for a user, newest first.
func (db *DB) GetAIPromptHistory(ctx context.Context, userID int64, promptType AIPromptType, limit int) ([]*AIPrompt, error) {
	query := `
		SELECT id, user_id, type, content, version, created_at
		FROM ai_prompts
		WHERE user_id = $1 AND type = $2
		ORDER BY version DESC
		LIMIT $3
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, promptType, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query AI prompt history: %w", err)
	}
	defer rows.Close()

	var prompts []*AIPrompt
	for rows.Next() {
		var p AIPrompt
		err := rows.Scan(&p.ID, &p.UserID, &p.Type, &p.Content, &p.Version, &p.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan AI prompt: %w", err)
		}
		prompts = append(prompts, &p)
	}

	return prompts, rows.Err()
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add internal/database/ai_prompts.go
git commit -m "feat: add AI prompt CRUD operations"
```

---

### Task 4: AI Prompt Generation Logic

**Files:**
- Modify: `internal/memory/service.go`

**Step 1: Add GenerateAIPrompts method**

Add at the end of `service.go`:

```go
// GenerateAIPrompts regenerates both AI-written prompts using the latest weekly memory.
// Called after weekly memory generation. For each prompt type (email_analyze, email_actions):
// 1. Loads the user-written system prompt
// 2. Loads the latest AI-written prompt (if any)
// 3. Loads the most recent weekly memory
// 4. Generates a new AI prompt version
func (s *Service) GenerateAIPrompts(ctx context.Context, userID int64) error {
	// Get the most recent weekly memory
	weeklyMemories, err := s.db.GetMemoriesByType(ctx, userID, database.MemoryTypeWeekly, 1)
	if err != nil {
		return fmt.Errorf("failed to get weekly memory: %w", err)
	}
	if len(weeklyMemories) == 0 {
		log.Printf("No weekly memory found for user %d, skipping AI prompt generation", userID)
		return nil
	}
	weeklyMemory := weeklyMemories[0]

	// Generate for both prompt types
	promptTypes := []struct {
		aiType     database.AIPromptType
		userType   database.PromptType
		label      string
	}{
		{database.AIPromptTypeEmailAnalyze, database.PromptTypeEmailAnalyze, "email analysis"},
		{database.AIPromptTypeEmailActions, database.PromptTypeEmailActions, "email actions"},
	}

	for _, pt := range promptTypes {
		if err := s.generateSingleAIPrompt(ctx, userID, pt.aiType, pt.userType, pt.label, weeklyMemory); err != nil {
			log.Printf("Failed to generate AI prompt for %s (user %d): %v", pt.label, userID, err)
			// Continue with the other prompt type
		}
	}

	return nil
}

func (s *Service) generateSingleAIPrompt(ctx context.Context, userID int64, aiType database.AIPromptType, userPromptType database.PromptType, label string, weeklyMemory *database.Memory) error {
	// 1. Get user-written system prompt
	userPromptContent := ""
	if userPrompt, err := s.db.GetSystemPrompt(ctx, userID, userPromptType); err == nil {
		userPromptContent = userPrompt.Content
	}

	// 2. Get latest AI-written prompt
	previousAIContent := ""
	if aiPrompt, err := s.db.GetLatestAIPrompt(ctx, userID, aiType); err == nil && aiPrompt != nil {
		previousAIContent = aiPrompt.Content
	}

	// 3. Build the meta-prompt
	systemPrompt := fmt.Sprintf(`You are an AI assistant that writes supplementary system prompt instructions for %s.

Your job is to write additional instructions that will be APPENDED to the user's system prompt when processing emails. These instructions should encode specific learnings, patterns, exceptions, and refinements discovered from processing emails over time.

Rules:
- NEVER contradict the user's original prompt - your instructions supplement it
- Be specific and actionable (e.g., "Emails from noreply@github.com with 'security alert' in subject should be labeled Urgent")
- Include sender-specific rules, content patterns, and learned exceptions
- Remove outdated rules that no longer apply
- Keep your output concise - aim for 200-500 words of clear, direct instructions
- Write in imperative form as instructions to an AI assistant (e.g., "Label X as Y", "Archive emails from Z")
- Do NOT include explanations of why - just the rules themselves`, label)

	var userPrompt string
	if previousAIContent != "" {
		userPrompt = fmt.Sprintf(`**USER'S ORIGINAL PROMPT (never modify, your output supplements this):**
%s

**YOUR PREVIOUS VERSION (evolve this):**
%s

**LATEST WEEKLY MEMORY (new learnings to incorporate):**
%s

Write an updated version of the supplementary instructions. Reinforce rules that continue to be relevant, add new rules from the weekly memory, and remove any that are outdated.`,
			userPromptContent, previousAIContent, weeklyMemory.Content)
	} else {
		userPrompt = fmt.Sprintf(`**USER'S ORIGINAL PROMPT (never modify, your output supplements this):**
%s

**LATEST WEEKLY MEMORY (learnings to base initial rules on):**
%s

Write the first version of supplementary instructions based on the patterns and learnings from the weekly memory.`,
			userPromptContent, weeklyMemory.Content)
	}

	// 4. Generate via OpenAI
	content, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		return fmt.Errorf("failed to generate AI prompt: %w", err)
	}

	// 5. Save new version
	aiPrompt := &database.AIPrompt{
		UserID:  userID,
		Type:    aiType,
		Content: content,
	}
	if err := s.db.CreateAIPrompt(ctx, aiPrompt); err != nil {
		return fmt.Errorf("failed to save AI prompt: %w", err)
	}

	log.Printf("✓ AI prompt for %s generated (user %d, version %d)", label, userID, aiPrompt.Version)
	return nil
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add internal/memory/service.go
git commit -m "feat: add AI prompt generation logic in memory service"
```

---

### Task 5: Append AI Prompts During Email Processing

**Files:**
- Modify: `internal/pipeline/processor.go`

**Step 1: Load and append AI prompts to system prompts**

In `ProcessEmail`, after the existing system prompt loading (lines 50-57), add AI prompt loading and append logic:

Replace lines 49-57:
```go
	// Get custom system prompts
	analyzePrompt := ""
	actionsPrompt := ""
	if prompt, err := p.db.GetSystemPrompt(ctx, user.ID, database.PromptTypeEmailAnalyze); err == nil {
		analyzePrompt = prompt.Content
	}
	if prompt, err := p.db.GetSystemPrompt(ctx, user.ID, database.PromptTypeEmailActions); err == nil {
		actionsPrompt = prompt.Content
	}
```

With:
```go
	// Get custom system prompts
	analyzePrompt := ""
	actionsPrompt := ""
	if prompt, err := p.db.GetSystemPrompt(ctx, user.ID, database.PromptTypeEmailAnalyze); err == nil {
		analyzePrompt = prompt.Content
	}
	if prompt, err := p.db.GetSystemPrompt(ctx, user.ID, database.PromptTypeEmailActions); err == nil {
		actionsPrompt = prompt.Content
	}

	// Append AI-generated prompt supplements (if any exist)
	if aiPrompt, err := p.db.GetLatestAIPrompt(ctx, user.ID, database.AIPromptTypeEmailAnalyze); err == nil && aiPrompt != nil {
		if analyzePrompt != "" {
			analyzePrompt += "\n\n" + aiPrompt.Content
		} else {
			analyzePrompt = aiPrompt.Content
		}
	}
	if aiPrompt, err := p.db.GetLatestAIPrompt(ctx, user.ID, database.AIPromptTypeEmailActions); err == nil && aiPrompt != nil {
		if actionsPrompt != "" {
			actionsPrompt += "\n\n" + aiPrompt.Content
		} else {
			actionsPrompt = aiPrompt.Content
		}
	}
```

**Step 2: Verify it compiles**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add internal/pipeline/processor.go
git commit -m "feat: append AI-generated prompts to system prompts during email processing"
```

---

### Task 6: Schedule AI Prompt Generation After Weekly Memory

**Files:**
- Modify: `internal/scheduler/scheduler.go`

**Step 1: Add AI prompt generation call to runWeeklyMemory**

In `runWeeklyMemory`, after the successful weekly memory generation, add AI prompt generation:

Replace the `runWeeklyMemory` function:
```go
func (s *Scheduler) runWeeklyMemory(ctx context.Context) {
	users, err := s.db.GetActiveUsers(ctx)
	if err != nil {
		log.Printf("Error getting active users for weekly memory: %v", err)
		return
	}

	for _, user := range users {
		log.Printf("Generating weekly memory for user %s", user.Email)
		if err := s.memoryService.GenerateWeeklyMemory(ctx, user.ID); err != nil {
			log.Printf("Failed to generate weekly memory for %s: %v", user.Email, err)
			continue
		}
		log.Printf("✓ Weekly memory generated for %s", user.Email)

		// Generate AI prompts based on the new weekly memory
		log.Printf("Generating AI prompts for user %s", user.Email)
		if err := s.memoryService.GenerateAIPrompts(ctx, user.ID); err != nil {
			log.Printf("Failed to generate AI prompts for %s: %v", user.Email, err)
		} else {
			log.Printf("✓ AI prompts generated for %s", user.Email)
		}
	}
}
```

Note: Changed `continue` instead of letting the loop proceed to AI prompt generation when weekly memory fails, since the AI prompt generation depends on the weekly memory.

**Step 2: Verify it compiles**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add internal/scheduler/scheduler.go
git commit -m "feat: trigger AI prompt generation after weekly memory"
```

---

### Task 7: Final Build Verification

**Step 1: Full build**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go build ./...`
Expected: No errors

**Step 2: Verify no vet issues**

Run: `cd /Users/den/Development/home/gmail-triage-assistant && go vet ./...`
Expected: No issues
