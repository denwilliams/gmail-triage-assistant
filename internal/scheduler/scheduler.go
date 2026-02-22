package scheduler

import (
	"context"
	"log"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/memory"
	"github.com/den/gmail-triage-assistant/internal/wrapup"
)

type Scheduler struct {
	db               *database.DB
	memoryService    *memory.Service
	wrapupService    *wrapup.Service
	stopChan         chan struct{}
	renewWatchesFunc func(ctx context.Context)
}

func NewScheduler(db *database.DB, memoryService *memory.Service, wrapupService *wrapup.Service) *Scheduler {
	return &Scheduler{
		db:            db,
		memoryService: memoryService,
		wrapupService: wrapupService,
		stopChan:      make(chan struct{}),
	}
}

// Start begins the scheduler loop
func (s *Scheduler) Start(ctx context.Context) {
	log.Println("📅 Scheduler starting...")

	// Track what's been run to avoid duplicates
	lastRunDate := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	morningRun := false
	eveningRun := false
	watchRenewalRun := false
	weeklyRun := false
	monthlyRun := false
	yearlyRun := false

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
				watchRenewalRun = false
			}

			hour, minute := now.Hour(), now.Minute()
			weekday := now.Weekday()
			day := now.Day()

			// 8AM: Morning wrapup
			if hour == 8 && minute == 0 && !morningRun {
				log.Println("⏰ 8AM - Running morning wrapup")
				morningRun = true
				go s.runMorningWrapup(ctx)
			}

			// 9AM: Renew Gmail watches (daily, if push notifications configured)
			if hour == 9 && minute == 0 && !watchRenewalRun && s.renewWatchesFunc != nil {
				log.Println("⏰ 9AM - Renewing Gmail watches")
				watchRenewalRun = true
				go s.renewWatchesFunc(ctx)
			}

			// 5PM: Evening wrapup + daily memory
			if hour == 17 && minute == 0 && !eveningRun {
				log.Println("⏰ 5PM - Running evening wrapup and daily memory")
				eveningRun = true
				go s.runEveningTasks(ctx)
			}

			// 6PM Saturday: Weekly memory consolidation
			if hour == 18 && minute == 0 && weekday == time.Saturday && !weeklyRun {
				log.Println("⏰ 6PM Saturday - Running weekly memory consolidation")
				weeklyRun = true
				go s.runWeeklyMemory(ctx)
			}

			// Reset weekly flag when we're no longer on Saturday
			if weekday != time.Saturday {
				weeklyRun = false
			}

			// 7PM 1st of month: Monthly memory consolidation
			if hour == 19 && minute == 0 && day == 1 && !monthlyRun {
				log.Println("⏰ 7PM 1st of month - Running monthly memory consolidation")
				monthlyRun = true
				go s.runMonthlyMemory(ctx)
			}

			// Reset monthly flag when we're past the 1st
			if day != 1 {
				monthlyRun = false
			}

			// 8PM January 1st: Yearly memory consolidation
			if hour == 20 && minute == 0 && now.Month() == time.January && day == 1 && !yearlyRun {
				log.Println("⏰ 8PM January 1st - Running yearly memory consolidation")
				yearlyRun = true
				go s.runYearlyMemory(ctx)
			}

			// Reset yearly flag when we're no longer on January 1st
			if now.Month() != time.January || day != 1 {
				yearlyRun = false
			}
		}
	}
}

// Stop gracefully stops the scheduler
func (s *Scheduler) Stop() {
	close(s.stopChan)
}

// SetWatchRenewerFunc sets the function to call for Gmail watch renewal.
// Must be called before Start. If set, it will be called at 9AM daily.
func (s *Scheduler) SetWatchRenewerFunc(fn func(ctx context.Context)) {
	s.renewWatchesFunc = fn
}

func (s *Scheduler) runMorningWrapup(ctx context.Context) {
	users, err := s.db.GetActiveUsers(ctx)
	if err != nil {
		log.Printf("Error getting active users for morning wrapup: %v", err)
		return
	}

	for _, user := range users {
		log.Printf("Generating morning wrapup for user %s", user.Email)
		if err := s.wrapupService.GenerateMorningWrapup(ctx, user.ID); err != nil {
			log.Printf("Failed to generate morning wrapup for %s: %v", user.Email, err)
		}
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
		if err := s.wrapupService.GenerateEveningWrapup(ctx, user.ID); err != nil {
			log.Printf("Failed to generate evening wrapup for %s: %v", user.Email, err)
		} else {
			log.Printf("✓ Evening wrapup generated for %s", user.Email)
		}

		// Generate daily memory
		log.Printf("Generating daily memory for user %s", user.Email)
		if err := s.memoryService.GenerateDailyMemory(ctx, user.ID); err != nil {
			log.Printf("Failed to generate daily memory for %s: %v", user.Email, err)
		} else {
			log.Printf("✓ Daily memory generated for %s", user.Email)
		}
	}
}

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
		} else {
			log.Printf("✓ Weekly memory generated for %s", user.Email)
		}
	}
}

func (s *Scheduler) runMonthlyMemory(ctx context.Context) {
	users, err := s.db.GetActiveUsers(ctx)
	if err != nil {
		log.Printf("Error getting active users for monthly memory: %v", err)
		return
	}

	for _, user := range users {
		log.Printf("Generating monthly memory for user %s", user.Email)
		if err := s.memoryService.GenerateMonthlyMemory(ctx, user.ID); err != nil {
			log.Printf("Failed to generate monthly memory for %s: %v", user.Email, err)
		} else {
			log.Printf("✓ Monthly memory generated for %s", user.Email)
		}
	}
}

func (s *Scheduler) runYearlyMemory(ctx context.Context) {
	users, err := s.db.GetActiveUsers(ctx)
	if err != nil {
		log.Printf("Error getting active users for yearly memory: %v", err)
		return
	}

	for _, user := range users {
		log.Printf("Generating yearly memory for user %s", user.Email)
		if err := s.memoryService.GenerateYearlyMemory(ctx, user.ID); err != nil {
			log.Printf("Failed to generate yearly memory for %s: %v", user.Email, err)
		} else {
			log.Printf("✓ Yearly memory generated for %s", user.Email)
		}
	}
}
