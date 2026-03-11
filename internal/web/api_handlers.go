package web

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/gorilla/mux"
)

// GET /api/v1/auth/me
func (s *Server) handleAPIAuthMe(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail, _ := session.Values["user_email"].(string)
	userID, _ := session.Values["user_id"].(int64)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"email":   userEmail,
		"user_id": userID,
	})
}

// GET /api/v1/labels
func (s *Server) handleAPIGetLabels(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	labels, err := s.db.GetAllLabels(ctx, userID)
	if err != nil {
		log.Printf("API: Failed to load labels: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load labels")
		return
	}

	respondJSON(w, http.StatusOK, labels)
}

// POST /api/v1/labels
func (s *Server) handleAPICreateLabel(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if body.Name == "" {
		respondError(w, http.StatusBadRequest, "Label name is required")
		return
	}

	ctx := context.Background()
	label := &database.Label{
		UserID:      userID,
		Name:        body.Name,
		Description: body.Description,
		Reasons:     []string{},
	}

	if err := s.db.CreateLabel(ctx, label); err != nil {
		log.Printf("API: Failed to create label: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to create label")
		return
	}

	respondJSON(w, http.StatusCreated, label)
}

// PUT /api/v1/labels/{id}
func (s *Server) handleAPIUpdateLabel(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	vars := mux.Vars(r)
	labelID := vars["id"]

	var body struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Reasons     []string `json:"reasons"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if body.Name == "" {
		respondError(w, http.StatusBadRequest, "Label name is required")
		return
	}

	id, err := strconv.ParseInt(labelID, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid label ID")
		return
	}

	ctx := context.Background()
	label := &database.Label{
		ID:          id,
		UserID:      userID,
		Name:        body.Name,
		Description: body.Description,
		Reasons:     body.Reasons,
	}
	if label.Reasons == nil {
		label.Reasons = []string{}
	}

	if err := s.db.UpdateLabel(ctx, label); err != nil {
		log.Printf("API: Failed to update label: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to update label")
		return
	}

	respondJSON(w, http.StatusOK, label)
}

// DELETE /api/v1/labels/{id}
func (s *Server) handleAPIDeleteLabel(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	vars := mux.Vars(r)
	labelID := vars["id"]

	ctx := context.Background()
	if err := s.db.DeleteLabel(ctx, userID, labelID); err != nil {
		log.Printf("API: Failed to delete label: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to delete label")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// GET /api/v1/emails
func (s *Server) handleAPIGetEmails(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	ctx := context.Background()
	emails, err := s.db.GetRecentEmails(ctx, userID, limit, offset)
	if err != nil {
		log.Printf("API: Failed to load emails: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load emails")
		return
	}

	respondJSON(w, http.StatusOK, emails)
}

// PUT /api/v1/emails/{id}/feedback
func (s *Server) handleAPIUpdateFeedback(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	vars := mux.Vars(r)
	emailID := vars["id"]

	var body struct {
		Feedback string `json:"feedback"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	ctx := context.Background()
	if err := s.db.UpdateEmailFeedback(ctx, userID, emailID, body.Feedback); err != nil {
		log.Printf("API: Failed to update feedback: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to save feedback")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// GET /api/v1/prompts
func (s *Server) handleAPIGetPrompts(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	prompts, err := s.db.GetAllSystemPrompts(ctx, userID)
	if err != nil {
		log.Printf("API: Failed to load prompts: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load prompts")
		return
	}

	aiAnalyze, _ := s.db.GetLatestAIPrompt(ctx, userID, database.AIPromptTypeEmailAnalyze)
	aiActions, _ := s.db.GetLatestAIPrompt(ctx, userID, database.AIPromptTypeEmailActions)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"prompts":    prompts,
		"ai_analyze": aiAnalyze,
		"ai_actions": aiActions,
	})
}

// PUT /api/v1/prompts
func (s *Server) handleAPIUpdatePrompt(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	var body struct {
		Type    string `json:"type"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	ctx := context.Background()
	prompt := &database.SystemPrompt{
		UserID:  userID,
		Type:    database.PromptType(body.Type),
		Content: body.Content,
	}

	if err := s.db.UpsertSystemPrompt(ctx, prompt); err != nil {
		log.Printf("API: Failed to update prompt: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to update prompt")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// POST /api/v1/prompts/defaults
func (s *Server) handleAPIInitDefaults(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	if err := s.db.InitializeDefaultPrompts(ctx, userID); err != nil {
		log.Printf("API: Failed to initialize defaults: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to initialize defaults")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "initialized"})
}

// GET /api/v1/memories
func (s *Server) handleAPIGetMemories(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	ctx := context.Background()
	memories, err := s.db.GetAllMemories(ctx, userID, limit)
	if err != nil {
		log.Printf("API: Failed to load memories: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load memories")
		return
	}

	respondJSON(w, http.StatusOK, memories)
}

// POST /api/v1/memories/generate
func (s *Server) handleAPIGenerateMemory(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	if err := s.memoryService.GenerateDailyMemory(ctx, userID); err != nil {
		log.Printf("API: Failed to generate memory: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to generate memory")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "generated"})
}

// POST /api/v1/memories/generate-ai-prompts
func (s *Server) handleAPIGenerateAIPrompts(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	if err := s.memoryService.GenerateAIPrompts(ctx, userID); err != nil {
		log.Printf("API: Failed to generate AI prompts: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to generate AI prompts")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "generated"})
}

// GET /api/v1/settings
func (s *Server) handleAPIGetSettings(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		log.Printf("API: Failed to load user: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load settings")
		return
	}

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
}

// PUT /api/v1/settings/pushover
func (s *Server) handleAPIUpdatePushover(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	var body struct {
		UserKey  string `json:"user_key"`
		AppToken string `json:"app_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	ctx := context.Background()
	if err := s.db.UpdatePushoverConfig(ctx, userID, body.UserKey, body.AppToken); err != nil {
		log.Printf("API: Failed to update pushover config: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to save Pushover settings")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

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

// GET /api/v1/notifications
func (s *Server) handleAPIGetNotifications(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	ctx := context.Background()
	notifications, err := s.db.GetNotificationsByUser(ctx, userID, limit)
	if err != nil {
		log.Printf("API: Failed to load notifications: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load notifications")
		return
	}

	respondJSON(w, http.StatusOK, notifications)
}

// GET /api/v1/sender-profiles?address=user@example.com
func (s *Server) handleAPIGetSenderProfiles(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	address := r.URL.Query().Get("address")
	if address == "" {
		respondError(w, http.StatusBadRequest, "address query parameter is required")
		return
	}

	ctx := context.Background()

	senderProfile, err := s.db.GetSenderProfile(ctx, userID, database.ProfileTypeSender, address)
	if err != nil {
		log.Printf("API: Failed to load sender profile: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load sender profile")
		return
	}

	var domainProfile *database.SenderProfile
	domain := database.ExtractDomain(address)
	if domain != "" && !database.IsIgnoredDomain(domain) {
		domainProfile, err = s.db.GetSenderProfile(ctx, userID, database.ProfileTypeDomain, domain)
		if err != nil {
			log.Printf("API: Failed to load domain profile: %v", err)
			respondError(w, http.StatusInternalServerError, "Failed to load domain profile")
			return
		}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"sender": senderProfile,
		"domain": domainProfile,
	})
}

// POST /api/v1/sender-profiles/generate
func (s *Server) handleAPIGenerateSenderProfile(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	var body struct {
		ProfileType string `json:"profile_type"`
		Identifier  string `json:"identifier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	profileType := database.ProfileType(body.ProfileType)
	if profileType != database.ProfileTypeSender && profileType != database.ProfileTypeDomain {
		respondError(w, http.StatusBadRequest, "profile_type must be 'sender' or 'domain'")
		return
	}
	if body.Identifier == "" {
		respondError(w, http.StatusBadRequest, "identifier is required")
		return
	}

	ctx := context.Background()

	// Fetch historical emails
	var emails []*database.Email
	var err error
	if profileType == database.ProfileTypeSender {
		emails, err = s.db.GetHistoricalEmailsFromAddress(ctx, userID, body.Identifier, 25)
	} else {
		emails, err = s.db.GetHistoricalEmailsFromDomain(ctx, userID, body.Identifier, 25)
	}
	if err != nil {
		log.Printf("API: Failed to get historical emails for %s: %v", body.Identifier, err)
		respondError(w, http.StatusInternalServerError, "Failed to get historical emails")
		return
	}

	// Build profile from historical data
	profile := database.BuildProfileFromEmails(userID, profileType, body.Identifier, emails)

	// Preserve existing profile ID if regenerating
	existing, _ := s.db.GetSenderProfile(ctx, userID, profileType, body.Identifier)
	if existing != nil {
		profile.ID = existing.ID
	}

	// If we have history, use AI to classify and summarize
	var aiError string
	if len(emails) > 0 && s.openaiClient != nil {
		result, err := s.openaiClient.BootstrapSenderProfile(ctx, body.Identifier, emails)
		if err != nil {
			log.Printf("API: Error bootstrapping profile for %s: %v", body.Identifier, err)
			aiError = err.Error()
		} else {
			profile.SenderType = result.SenderType
			profile.Summary = result.Summary
		}
	} else if s.openaiClient == nil {
		aiError = "openai client not configured"
	} else {
		aiError = "no historical emails found"
	}

	// Save the profile
	if err := s.db.UpsertSenderProfile(ctx, profile); err != nil {
		log.Printf("API: Failed to save profile for %s: %v", body.Identifier, err)
		respondError(w, http.StatusInternalServerError, "Failed to save profile")
		return
	}

	// Re-fetch to get DB-assigned ID and timestamps
	saved, err := s.db.GetSenderProfile(ctx, userID, profileType, body.Identifier)
	if err != nil || saved == nil {
		log.Printf("API: Failed to re-fetch profile for %s: %v", body.Identifier, err)
		respondJSON(w, http.StatusOK, profile)
		return
	}

	log.Printf("API: Generated %s profile for %s (emails: %d, ai_error: %s)", profileType, body.Identifier, len(emails), aiError)

	response := map[string]any{
		"profile": saved,
	}
	if aiError != "" {
		response["ai_error"] = aiError
	}
	respondJSON(w, http.StatusOK, response)
}

// PATCH /api/v1/sender-profiles/{id}
func (s *Server) handleAPIUpdateSenderProfile(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid profile ID")
		return
	}

	var body struct {
		Summary     *string         `json:"summary"`
		LabelCounts *map[string]int `json:"label_counts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	ctx := context.Background()

	profile, err := s.db.GetSenderProfileByID(ctx, userID, id)
	if err != nil {
		log.Printf("API: Failed to load sender profile: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load profile")
		return
	}
	if profile == nil {
		respondError(w, http.StatusNotFound, "Profile not found")
		return
	}

	if body.Summary != nil {
		profile.Summary = *body.Summary
	}
	if body.LabelCounts != nil {
		profile.LabelCounts = *body.LabelCounts
	}

	if err := s.db.UpsertSenderProfile(ctx, profile); err != nil {
		log.Printf("API: Failed to update sender profile: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to update profile")
		return
	}

	respondJSON(w, http.StatusOK, profile)
}

// GET /api/v1/stats/summary
func (s *Server) handleAPIGetStatsSummary(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	summary, err := s.db.GetDashboardSummary(ctx, userID)
	if err != nil {
		log.Printf("API: Failed to load stats summary: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load stats summary")
		return
	}

	respondJSON(w, http.StatusOK, summary)
}

// GET /api/v1/stats/timeseries?days=30
func (s *Server) handleAPIGetStatsTimeseries(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 365 {
			days = parsed
		}
	}

	ctx := context.Background()
	timeseries, err := s.db.GetDashboardTimeseries(ctx, userID, days)
	if err != nil {
		log.Printf("API: Failed to load stats timeseries: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load stats timeseries")
		return
	}

	respondJSON(w, http.StatusOK, timeseries)
}

// GET /api/v1/wrapups
func (s *Server) handleAPIGetWrapups(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	limit := 30
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	ctx := context.Background()
	reports, err := s.db.GetWrapupReportsByUser(ctx, userID, limit)
	if err != nil {
		log.Printf("API: Failed to load wrapup reports: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to load wrapup reports")
		return
	}

	respondJSON(w, http.StatusOK, reports)
}

// GET /api/v1/export
func (s *Server) handleAPIExport(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)
	ctx := context.Background()

	includeEmails := r.URL.Query().Get("include_emails") == "true"

	envelope := database.ExportEnvelope{
		Version:       1,
		ExportedAt:    time.Now(),
		App:           "gmail-triage-assistant",
		IncludeEmails: includeEmails,
	}

	var err error
	if envelope.Data.Labels, err = s.db.ExportLabels(ctx, userID); err != nil {
		log.Printf("API: Failed to export labels: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export labels")
		return
	}
	if envelope.Data.SystemPrompts, err = s.db.ExportSystemPrompts(ctx, userID); err != nil {
		log.Printf("API: Failed to export system prompts: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export system prompts")
		return
	}
	if envelope.Data.AIPrompts, err = s.db.ExportAIPrompts(ctx, userID); err != nil {
		log.Printf("API: Failed to export AI prompts: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export AI prompts")
		return
	}
	if envelope.Data.Memories, err = s.db.ExportMemories(ctx, userID); err != nil {
		log.Printf("API: Failed to export memories: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export memories")
		return
	}
	if envelope.Data.SenderProfiles, err = s.db.ExportSenderProfiles(ctx, userID); err != nil {
		log.Printf("API: Failed to export sender profiles: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export sender profiles")
		return
	}
	if envelope.Data.WrapupReports, err = s.db.ExportWrapupReports(ctx, userID); err != nil {
		log.Printf("API: Failed to export wrapup reports: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export wrapup reports")
		return
	}
	if envelope.Data.Notifications, err = s.db.ExportNotifications(ctx, userID); err != nil {
		log.Printf("API: Failed to export notifications: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to export notifications")
		return
	}
	if includeEmails {
		if envelope.Data.Emails, err = s.db.ExportEmails(ctx, userID); err != nil {
			log.Printf("API: Failed to export emails: %v", err)
			respondError(w, http.StatusInternalServerError, "Failed to export emails")
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=gmail-triage-export.json")
	json.NewEncoder(w).Encode(envelope)
}

// POST /api/v1/import
func (s *Server) handleAPIImport(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)
	ctx := context.Background()

	// Limit request body to 100MB
	r.Body = http.MaxBytesReader(w, r.Body, 100<<20)

	var envelope database.ExportEnvelope
	if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON or file too large")
		return
	}

	if envelope.App != "gmail-triage-assistant" {
		respondError(w, http.StatusBadRequest, "Invalid export file: wrong app identifier")
		return
	}
	if envelope.Version != 1 {
		respondError(w, http.StatusBadRequest, "Unsupported export version")
		return
	}

	result, err := s.db.ImportAllData(ctx, userID, envelope.Data)
	if err != nil {
		log.Printf("API: Failed to import data: %v", err)
		respondError(w, http.StatusInternalServerError, "Import failed: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, result)
}
