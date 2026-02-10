# Implementation Notes

## Hierarchical Memory System - Completed 2026-02-10

### Overview
Implemented a complete hierarchical memory consolidation system that automatically generates insights from email processing patterns at multiple time scales.

### Architecture

#### Scheduler (`internal/scheduler/scheduler.go`)
- Ticker-based system checking every minute
- Tracks execution flags to prevent duplicate runs
- Resets flags based on date/day/month changes

#### Memory Service (`internal/memory/service.go`)
Four memory generation methods:
1. **GenerateDailyMemory**: Analyzes emails from yesterday (or last 24h)
2. **GenerateWeeklyMemory**: Consolidates past 7 daily memories
3. **GenerateMonthlyMemory**: Consolidates weekly memories from past month
4. **GenerateYearlyMemory**: Consolidates monthly memories from past year

#### Wrapup Service (`internal/wrapup/service.go`)
Two wrapup report generators:
1. **GenerateMorningWrapup**: Summarizes emails since 5PM yesterday
2. **GenerateEveningWrapup**: Summarizes emails since 8AM today

### Schedule

| Time | Day | Task | Description |
|------|-----|------|-------------|
| 8AM | Daily | Morning Wrapup | Summary of emails processed since 5PM yesterday |
| 5PM | Daily | Evening Wrapup + Daily Memory | Summary of today's emails + generate learning insights |
| 6PM | Saturday | Weekly Memory | Consolidate past 7 daily memories |
| 7PM | 1st of Month | Monthly Memory | Consolidate weekly memories from past month |
| 8PM | January 1st | Yearly Memory | Consolidate monthly memories from past year |

### Database

**Tables:**
- `wrapup_reports`: Stores morning/evening summaries
- `memories`: Stores all memory types with `type` field (daily/weekly/monthly/yearly)

**Key Methods:**
- `GetMemoriesByDateRange`: Fetches memories of specific type within date range
- `GetRecentMemoriesForContext`: Single-query UNION ALL fetch of 1 yearly + 1 monthly + 1 weekly + 7 daily

### AI Integration

**System Prompts:**
Each memory/wrapup type can have custom prompts via `system_prompts` table:
- `daily_review`: Daily memory generation
- `weekly_summary`: Weekly consolidation
- `monthly_summary`: Monthly consolidation
- `yearly_summary`: Yearly consolidation
- `wrapup_report`: Morning/evening wrapups

**Memory Usage:**
All recent memories are automatically included in email processing AI prompts via `GetRecentMemoriesForContext`, providing historical learning context.

### Benefits

1. **Progressive abstraction**: Each level distills insights from the level below
2. **Long-term learning**: Yearly memories capture multi-month patterns
3. **Automatic execution**: No manual intervention required
4. **Customizable prompts**: Users can tune what insights they want extracted
5. **Context for AI**: Past learnings inform future email processing decisions

### Implementation Details

**Flag Management:**
- Daily flags reset when date changes
- Weekly flag resets when no longer Saturday
- Monthly flag resets when no longer 1st of month
- Yearly flag resets when no longer January 1st

**Graceful Degradation:**
- Daily memory falls back to last 24h if yesterday empty (for manual testing)
- All operations skip gracefully if no source data available
- Errors logged but don't crash scheduler

**Multi-user Support:**
- All scheduled tasks iterate over active users (`GetActiveUsers`)
- Each user gets independent memories and wrapups
- Tasks run as goroutines for parallel processing

### Files Modified

1. `internal/memory/service.go`: Added weekly/monthly/yearly generation
2. `internal/wrapup/service.go`: Created wrapup report service
3. `internal/scheduler/scheduler.go`: Implemented complete scheduling logic
4. `internal/database/memories.go`: Added `GetMemoriesByDateRange` method
5. `cmd/server/main.go`: Wired up wrapup service and updated logging
6. `TODO.md`: Marked Phase 7 complete
7. `CLAUDE.md`: Updated with complete schedule details

### Testing

To test manually:
1. Process some emails during the day
2. Run `curl -X POST http://localhost:8080/api/memories/generate?user_id=1` to generate daily memory
3. Check logs to see memory generation output
4. Scheduler will automatically run at scheduled times in production

### Future Improvements

- Add UI to view wrapup reports
- Allow manual triggering of weekly/monthly/yearly memories from UI
- Add statistics about memory generation (count, tokens used, etc.)
- Consider adding quarterly memories between monthly and yearly
