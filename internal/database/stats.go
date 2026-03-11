package database

import (
	"context"
	"fmt"
	"time"
)

// Summary response types

type SenderStat struct {
	Address     string  `json:"address"`
	Count       int     `json:"count"`
	ArchiveRate float64 `json:"archive_rate"`
}

type DomainStat struct {
	Domain      string  `json:"domain"`
	Count       int     `json:"count"`
	ArchiveRate float64 `json:"archive_rate"`
}

type SlugStat struct {
	Slug  string `json:"slug"`
	Count int    `json:"count"`
}

type LabelStat struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type KeywordStat struct {
	Keyword string `json:"keyword"`
	Count   int    `json:"count"`
}

type DashboardSummary struct {
	TotalEmails      int     `json:"total_emails"`
	EmailsToday      int     `json:"emails_today"`
	EmailsThisWeek   int     `json:"emails_this_week"`
	UniqueSenders    int     `json:"unique_senders"`
	BypassRate       float64 `json:"bypass_rate"`
	NotificationRate float64 `json:"notification_rate"`

	TopSenders  []SenderStat  `json:"top_senders"`
	TopDomains  []DomainStat  `json:"top_domains"`
	TopSlugs    []SlugStat    `json:"top_slugs"`
	LabelDist   []LabelStat   `json:"label_distribution"`
	TopKeywords []KeywordStat `json:"top_keywords"`

	NewSlugsThisWeek       int `json:"new_slugs_this_week"`
	RecurringSlugsThisWeek int `json:"recurring_slugs_this_week"`
}

// Timeseries response types

type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type DayRate struct {
	Date  string  `json:"date"`
	Total int     `json:"total"`
	Count int     `json:"count"`
	Rate  float64 `json:"rate"`
}

type DayLabelCount struct {
	Date  string `json:"date"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type HourCount struct {
	DayOfWeek int `json:"day_of_week"`
	Hour      int `json:"hour"`
	Count     int `json:"count"`
}

type DashboardTimeseries struct {
	DailyVolume        []DayCount      `json:"daily_volume"`
	DailyBypassRate    []DayRate       `json:"daily_bypass_rate"`
	DailyNotifications []DayCount      `json:"daily_notifications"`
	LabelTrends        []DayLabelCount `json:"label_trends"`
	HourlyHeatmap      []HourCount     `json:"hourly_heatmap"`
}

func (db *DB) GetDashboardSummary(ctx context.Context, userID int64) (*DashboardSummary, error) {
	s := &DashboardSummary{}

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekStart := todayStart.AddDate(0, 0, -int(todayStart.Weekday()))

	// Counts: total, today, this week, unique senders, bypass rate, notification rate
	err := db.conn.QueryRowContext(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE processed_at >= $2),
			COUNT(*) FILTER (WHERE processed_at >= $3),
			COUNT(DISTINCT from_address),
			COALESCE(AVG(CASE WHEN bypassed_inbox THEN 1.0 ELSE 0.0 END), 0),
			COALESCE(AVG(CASE WHEN notification_sent THEN 1.0 ELSE 0.0 END), 0)
		FROM emails WHERE user_id = $1
	`, userID, todayStart, weekStart).Scan(
		&s.TotalEmails, &s.EmailsToday, &s.EmailsThisWeek,
		&s.UniqueSenders, &s.BypassRate, &s.NotificationRate,
	)
	if err != nil {
		return nil, fmt.Errorf("stats counts query failed: %w", err)
	}

	// Top 15 senders
	rows, err := db.conn.QueryContext(ctx, `
		SELECT from_address, COUNT(*) as cnt,
			AVG(CASE WHEN bypassed_inbox THEN 1.0 ELSE 0.0 END) as archive_rate
		FROM emails WHERE user_id = $1
		GROUP BY from_address ORDER BY cnt DESC LIMIT 15
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("top senders query failed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var st SenderStat
		if err := rows.Scan(&st.Address, &st.Count, &st.ArchiveRate); err != nil {
			return nil, fmt.Errorf("top senders scan failed: %w", err)
		}
		s.TopSenders = append(s.TopSenders, st)
	}
	if s.TopSenders == nil {
		s.TopSenders = []SenderStat{}
	}

	// Top 15 domains
	rows2, err := db.conn.QueryContext(ctx, `
		SELECT from_domain, COUNT(*) as cnt,
			AVG(CASE WHEN bypassed_inbox THEN 1.0 ELSE 0.0 END) as archive_rate
		FROM emails WHERE user_id = $1 AND from_domain != ''
		GROUP BY from_domain ORDER BY cnt DESC LIMIT 15
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("top domains query failed: %w", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var dt DomainStat
		if err := rows2.Scan(&dt.Domain, &dt.Count, &dt.ArchiveRate); err != nil {
			return nil, fmt.Errorf("top domains scan failed: %w", err)
		}
		s.TopDomains = append(s.TopDomains, dt)
	}
	if s.TopDomains == nil {
		s.TopDomains = []DomainStat{}
	}

	// Top 20 slugs
	rows3, err := db.conn.QueryContext(ctx, `
		SELECT slug, COUNT(*) as cnt
		FROM emails WHERE user_id = $1
		GROUP BY slug ORDER BY cnt DESC LIMIT 20
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("top slugs query failed: %w", err)
	}
	defer rows3.Close()
	for rows3.Next() {
		var st SlugStat
		if err := rows3.Scan(&st.Slug, &st.Count); err != nil {
			return nil, fmt.Errorf("top slugs scan failed: %w", err)
		}
		s.TopSlugs = append(s.TopSlugs, st)
	}
	if s.TopSlugs == nil {
		s.TopSlugs = []SlugStat{}
	}

	// Label distribution
	rows4, err := db.conn.QueryContext(ctx, `
		SELECT label, COUNT(*) as cnt
		FROM emails, jsonb_array_elements_text(labels_applied) AS label
		WHERE user_id = $1
		GROUP BY label ORDER BY cnt DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("label distribution query failed: %w", err)
	}
	defer rows4.Close()
	for rows4.Next() {
		var ls LabelStat
		if err := rows4.Scan(&ls.Label, &ls.Count); err != nil {
			return nil, fmt.Errorf("label distribution scan failed: %w", err)
		}
		s.LabelDist = append(s.LabelDist, ls)
	}
	if s.LabelDist == nil {
		s.LabelDist = []LabelStat{}
	}

	// Top 50 keywords
	rows5, err := db.conn.QueryContext(ctx, `
		SELECT kw, COUNT(*) as cnt
		FROM emails, jsonb_array_elements_text(keywords) AS kw
		WHERE user_id = $1
		GROUP BY kw ORDER BY cnt DESC LIMIT 50
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("top keywords query failed: %w", err)
	}
	defer rows5.Close()
	for rows5.Next() {
		var ks KeywordStat
		if err := rows5.Scan(&ks.Keyword, &ks.Count); err != nil {
			return nil, fmt.Errorf("top keywords scan failed: %w", err)
		}
		s.TopKeywords = append(s.TopKeywords, ks)
	}
	if s.TopKeywords == nil {
		s.TopKeywords = []KeywordStat{}
	}

	// New vs recurring slugs this week
	err = db.conn.QueryRowContext(ctx, `
		WITH this_week AS (
			SELECT DISTINCT slug FROM emails
			WHERE user_id = $1 AND processed_at >= $2
		),
		before_week AS (
			SELECT DISTINCT slug FROM emails
			WHERE user_id = $1 AND processed_at < $2
		)
		SELECT
			(SELECT COUNT(*) FROM this_week WHERE slug NOT IN (SELECT slug FROM before_week)),
			(SELECT COUNT(*) FROM this_week WHERE slug IN (SELECT slug FROM before_week))
	`, userID, weekStart).Scan(&s.NewSlugsThisWeek, &s.RecurringSlugsThisWeek)
	if err != nil {
		return nil, fmt.Errorf("slug novelty query failed: %w", err)
	}

	return s, nil
}

func (db *DB) GetDashboardTimeseries(ctx context.Context, userID int64, days int) (*DashboardTimeseries, error) {
	ts := &DashboardTimeseries{}

	since := time.Now().AddDate(0, 0, -days)

	// Daily email count
	rows, err := db.conn.QueryContext(ctx, `
		SELECT DATE(processed_at) as day, COUNT(*) as cnt
		FROM emails WHERE user_id = $1 AND processed_at >= $2
		GROUP BY day ORDER BY day
	`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("daily volume query failed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var dc DayCount
		var t time.Time
		if err := rows.Scan(&t, &dc.Count); err != nil {
			return nil, fmt.Errorf("daily volume scan failed: %w", err)
		}
		dc.Date = t.Format("2006-01-02")
		ts.DailyVolume = append(ts.DailyVolume, dc)
	}
	if ts.DailyVolume == nil {
		ts.DailyVolume = []DayCount{}
	}

	// Daily bypass rate
	rows2, err := db.conn.QueryContext(ctx, `
		SELECT DATE(processed_at) as day,
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE bypassed_inbox) as bypassed,
			COALESCE(AVG(CASE WHEN bypassed_inbox THEN 1.0 ELSE 0.0 END), 0) as rate
		FROM emails WHERE user_id = $1 AND processed_at >= $2
		GROUP BY day ORDER BY day
	`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("daily bypass rate query failed: %w", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var dr DayRate
		var t time.Time
		if err := rows2.Scan(&t, &dr.Total, &dr.Count, &dr.Rate); err != nil {
			return nil, fmt.Errorf("daily bypass rate scan failed: %w", err)
		}
		dr.Date = t.Format("2006-01-02")
		ts.DailyBypassRate = append(ts.DailyBypassRate, dr)
	}
	if ts.DailyBypassRate == nil {
		ts.DailyBypassRate = []DayRate{}
	}

	// Daily notification count
	rows3, err := db.conn.QueryContext(ctx, `
		SELECT DATE(processed_at) as day, COUNT(*) as cnt
		FROM emails WHERE user_id = $1 AND processed_at >= $2 AND notification_sent = true
		GROUP BY day ORDER BY day
	`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("daily notifications query failed: %w", err)
	}
	defer rows3.Close()
	for rows3.Next() {
		var dc DayCount
		var t time.Time
		if err := rows3.Scan(&t, &dc.Count); err != nil {
			return nil, fmt.Errorf("daily notifications scan failed: %w", err)
		}
		dc.Date = t.Format("2006-01-02")
		ts.DailyNotifications = append(ts.DailyNotifications, dc)
	}
	if ts.DailyNotifications == nil {
		ts.DailyNotifications = []DayCount{}
	}

	// Label trends per day
	rows4, err := db.conn.QueryContext(ctx, `
		SELECT DATE(processed_at) as day, label, COUNT(*) as cnt
		FROM emails, jsonb_array_elements_text(labels_applied) AS label
		WHERE user_id = $1 AND processed_at >= $2
		GROUP BY day, label ORDER BY day, cnt DESC
	`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("label trends query failed: %w", err)
	}
	defer rows4.Close()
	for rows4.Next() {
		var dlc DayLabelCount
		var t time.Time
		if err := rows4.Scan(&t, &dlc.Label, &dlc.Count); err != nil {
			return nil, fmt.Errorf("label trends scan failed: %w", err)
		}
		dlc.Date = t.Format("2006-01-02")
		ts.LabelTrends = append(ts.LabelTrends, dlc)
	}
	if ts.LabelTrends == nil {
		ts.LabelTrends = []DayLabelCount{}
	}

	// Hourly heatmap (all time)
	rows5, err := db.conn.QueryContext(ctx, `
		SELECT EXTRACT(DOW FROM processed_at)::int as dow,
			EXTRACT(HOUR FROM processed_at)::int as hr,
			COUNT(*) as cnt
		FROM emails WHERE user_id = $1
		GROUP BY dow, hr ORDER BY dow, hr
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("hourly heatmap query failed: %w", err)
	}
	defer rows5.Close()
	for rows5.Next() {
		var hc HourCount
		if err := rows5.Scan(&hc.DayOfWeek, &hc.Hour, &hc.Count); err != nil {
			return nil, fmt.Errorf("hourly heatmap scan failed: %w", err)
		}
		ts.HourlyHeatmap = append(ts.HourlyHeatmap, hc)
	}
	if ts.HourlyHeatmap == nil {
		ts.HourlyHeatmap = []HourCount{}
	}

	return ts, nil
}
