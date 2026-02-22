package web

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

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

	ctx := context.Background()
	emails, err := s.db.GetRecentEmails(ctx, userID, limit)
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
