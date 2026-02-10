package scheduler

import (
	"context"
	"log"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/memory"
)

type Scheduler struct {
	db            *database.DB
	memoryService *memory.Service
	stopChan      chan struct{}
}

func NewScheduler(db *database.DB, memoryService *memory.Service) *Scheduler {
	return &Scheduler{
		db:            db,
		memoryService: memoryService,
		stopChan:      make(chan struct{}),
	}
}

// Start begins the scheduler loop
func (s *Scheduler) Start(ctx context.Context) {
	log.Println("📅 Scheduler starting...")

	// Track what's been run today to avoid duplicates
	lastRunDate := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	morningRun := false
	eveningRun := false

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Scheduler stopping...")
			return
		case <-s.stopChan:
			log.Println("Scheduler stopped")
			return
		case now := <-ticker.C:
			currentDate := now.Format("2006-01-02")

			// Reset daily flags when date changes
			if currentDate != lastRunDate {
				log.Printf("New day detected: %s", currentDate)
				lastRunDate = currentDate
				morningRun = false
				eveningRun = false
			}

			hour, minute := now.Hour(), now.Minute()

			// 8AM: Morning wrapup
			if hour == 8 && minute == 0 && !morningRun {
				log.Println("⏰ 8AM - Running morning wrapup")
				morningRun = true
				go s.runMorningWrapup(ctx)
			}

			// 5PM: Evening wrapup + daily memory
			if hour == 17 && minute == 0 && !eveningRun {
				log.Println("⏰ 5PM - Running evening wrapup and daily memory")
				eveningRun = true
				go s.runEveningTasks(ctx)
			}
		}
	}
}

// Stop gracefully stops the scheduler
func (s *Scheduler) Stop() {
	close(s.stopChan)
}

func (s *Scheduler) runMorningWrapup(ctx context.Context) {
	users, err := s.db.GetActiveUsers(ctx)
	if err != nil {
		log.Printf("Error getting active users for morning wrapup: %v", err)
		return
	}

	for _, user := range users {
		log.Printf("Generating morning wrapup for user %s", user.Email)
		// TODO: Implement wrapup generation
		// For now just log that we'd generate it
		log.Printf("Morning wrapup for %s (not yet implemented)", user.Email)
	}
}

func (s *Scheduler) runEveningTasks(ctx context.Context) {
	users, err := s.db.GetActiveUsers(ctx)
	if err != nil {
		log.Printf("Error getting active users for evening tasks: %v", err)
		return
	}

	for _, user := range users {
		// Generate evening wrapup
		log.Printf("Generating evening wrapup for user %s", user.Email)
		// TODO: Implement wrapup generation
		log.Printf("Evening wrapup for %s (not yet implemented)", user.Email)

		// Generate daily memory
		log.Printf("Generating daily memory for user %s", user.Email)
		if err := s.memoryService.GenerateDailyMemory(ctx, user.ID); err != nil {
			log.Printf("Failed to generate daily memory for %s: %v", user.Email, err)
		} else {
			log.Printf("✓ Daily memory generated for %s", user.Email)
		}
	}
}
