# AI-Written Prompt Evolution System

## Problem

The system learns from email processing via hierarchical memories (daily/weekly/monthly/yearly), but these learnings are only passed as context in the user message. The system prompts themselves never evolve. This means the AI's core instructions remain static even as it accumulates significant pattern knowledge.

## Solution

Two new AI-generated prompts (`email_analyze` and `email_actions`) that evolve weekly. These are appended to user-written system prompts at email processing time, creating self-improving instructions.

## Architecture

### New Table: `ai_prompts`

```sql
CREATE TABLE ai_prompts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    type TEXT CHECK(type IN ('email_analyze', 'email_actions')),
    content TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_ai_prompts_user_type ON ai_prompts(user_id, type, version DESC);
```

Each regeneration inserts a new row with incremented version. Latest version is used for processing; history preserved.

### Prompt Assembly

At email processing time:

```
final_system_prompt = user_written_prompt + "\n\n" + latest_ai_written_prompt
```

If no AI prompt exists yet, behavior is unchanged.

### Weekly Regeneration

After `GenerateWeeklyMemory` completes (6PM Saturday), for each prompt type:

1. Load user-written system prompt (`email_analyze` / `email_actions`)
2. Load latest AI-written prompt (or empty string if first generation)
3. Load most recent weekly memory
4. Call OpenAI to generate new AI prompt
5. Insert as new version in `ai_prompts`

### Meta-Prompt Design

The AI generating these prompts is instructed to:
- Write supplementary instructions that complement the user prompt
- Incorporate specific learnings from the weekly memory
- Add clarifications, exceptions, and refinements
- Never contradict the user's stated intent
- Keep prompts concise and actionable

### Example

User prompt: "Keep me updated with LinkedIn emails"

AI prompt (after learning): "LinkedIn notification emails about conference invitations from unknown profiles should bypass the inbox. LinkedIn messages from 1st-degree connections should always stay in inbox. Job alert digests can be archived with the 'Newsletters' label."

## Files Changed

- `internal/database/migrations/008_add_ai_prompts.sql` - New table
- `internal/database/models.go` - AIPrompt model + AIPromptType
- `internal/database/ai_prompts.go` - CRUD operations
- `internal/memory/service.go` - Add `GenerateAIPrompts` method
- `internal/pipeline/processor.go` - Append AI prompts to system prompts
- `internal/scheduler/scheduler.go` - Trigger AI prompt generation after weekly memory
- `internal/web/handlers.go` - (optional) UI to view AI prompt history
