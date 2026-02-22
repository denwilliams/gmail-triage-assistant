package web

import (
	"context"
	"embed"
	"fmt"
	"html/template"
	"log"
	"net/http"

	"github.com/den/gmail-triage-assistant/internal/config"
	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/memory"
	"github.com/gorilla/mux"
	"github.com/gorilla/sessions"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/gmail/v1"
	googleoauth2 "google.golang.org/api/oauth2/v2"
	"google.golang.org/api/option"
)

//go:embed templates/*.html
var templatesFS embed.FS

type Server struct {
	router        *mux.Router
	db            *database.DB
	config        *config.Config
	sessionStore  *sessions.CookieStore
	oauthConfig   *oauth2.Config
	templates     *template.Template
	memoryService *memory.Service
}

func NewServer(db *database.DB, cfg *config.Config, memoryService *memory.Service) *Server {
	store := sessions.NewCookieStore([]byte(cfg.SessionSecret))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
		Secure:   cfg.SessionSecret != "replace-with-32-byte-random-key-in-production",
		SameSite: http.SameSiteLaxMode,
	}

	oauthConfig := &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
		Scopes: []string{
			gmail.GmailModifyScope,
			"https://www.googleapis.com/auth/userinfo.email",
		},
		Endpoint: google.Endpoint,
	}

	// Load templates from embedded filesystem
	tmpl := template.Must(template.ParseFS(templatesFS, "templates/*.html"))

	s := &Server{
		router:        mux.NewRouter(),
		db:            db,
		config:        cfg,
		sessionStore:  store,
		oauthConfig:   oauthConfig,
		templates:     tmpl,
		memoryService: memoryService,
	}

	s.routes()
	return s
}

func (s *Server) routes() {
	// OAuth routes
	s.router.HandleFunc("/", s.handleHome).Methods("GET")
	s.router.HandleFunc("/auth/login", s.handleLogin).Methods("GET")
	s.router.HandleFunc("/auth/callback", s.handleCallback).Methods("GET")
	s.router.HandleFunc("/auth/logout", s.handleLogout).Methods("GET")

	// Dashboard (requires auth)
	s.router.HandleFunc("/dashboard", s.requireAuth(s.handleDashboard)).Methods("GET")

	// Labels management (requires auth)
	s.router.HandleFunc("/labels", s.requireAuth(s.handleLabels)).Methods("GET")
	s.router.HandleFunc("/labels/create", s.requireAuth(s.handleCreateLabel)).Methods("POST")
	s.router.HandleFunc("/labels/{id}/delete", s.requireAuth(s.handleDeleteLabel)).Methods("POST")

	// Email history (requires auth)
	s.router.HandleFunc("/history", s.requireAuth(s.handleHistory)).Methods("GET")
	s.router.HandleFunc("/history/feedback", s.requireAuth(s.handleUpdateFeedback)).Methods("POST")

	// System prompts (requires auth)
	s.router.HandleFunc("/prompts", s.requireAuth(s.handlePrompts)).Methods("GET")
	s.router.HandleFunc("/prompts/update", s.requireAuth(s.handleUpdatePrompt)).Methods("POST")
	s.router.HandleFunc("/prompts/defaults", s.requireAuth(s.handleInitDefaults)).Methods("GET")

	// Memories (requires auth)
	s.router.HandleFunc("/memories", s.requireAuth(s.handleMemories)).Methods("GET")
	s.router.HandleFunc("/memories/generate", s.requireAuth(s.handleGenerateMemory)).Methods("POST")

	// Wrapup Reports (requires auth)
	s.router.HandleFunc("/wrapups", s.requireAuth(s.handleWrapups)).Methods("GET")
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail, ok := session.Values["user_email"].(string)

	if ok && userEmail != "" {
		http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
		return
	}

	data := map[string]interface{}{
		"Title":        "Home",
		"ShowNav":      false,
		"TemplateName": "home",
	}

	if err := s.templates.ExecuteTemplate(w, "home", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	url := s.oauthConfig.AuthCodeURL("state", oauth2.AccessTypeOffline, oauth2.ApprovalForce)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "No code in request", http.StatusBadRequest)
		return
	}

	ctx := context.Background()

	// Exchange code for token
	token, err := s.oauthConfig.Exchange(ctx, code)
	if err != nil {
		log.Printf("Failed to exchange code for token: %v", err)
		http.Error(w, "Failed to authenticate", http.StatusInternalServerError)
		return
	}

	// Get user info from Google
	oauth2Service, err := googleoauth2.NewService(ctx, option.WithTokenSource(s.oauthConfig.TokenSource(ctx, token)))
	if err != nil {
		log.Printf("Failed to create OAuth2 service: %v", err)
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	userInfo, err := oauth2Service.Userinfo.Get().Do()
	if err != nil {
		log.Printf("Failed to get user info: %v", err)
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	// Check if user exists
	user, err := s.db.GetUserByGoogleID(ctx, userInfo.Id)
	if err != nil {
		// User doesn't exist, create new user
		user, err = s.db.CreateUser(ctx, userInfo.Email, userInfo.Id, token)
		if err != nil {
			log.Printf("Failed to create user: %v", err)
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
			return
		}
		log.Printf("Created new user: %s", userInfo.Email)
	} else {
		// User exists, update token
		err = s.db.UpdateUserToken(ctx, user.ID, token)
		if err != nil {
			log.Printf("Failed to update user token: %v", err)
			http.Error(w, "Failed to update user", http.StatusInternalServerError)
			return
		}
		log.Printf("Updated user token: %s", userInfo.Email)
	}

	// Save user to session
	session, _ := s.sessionStore.Get(r, "session")
	session.Values["user_id"] = user.ID
	session.Values["user_email"] = user.Email
	err = session.Save(r, w)
	if err != nil {
		log.Printf("Failed to save session: %v", err)
		http.Error(w, "Failed to save session", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	session.Values["user_id"] = nil
	session.Values["user_email"] = nil
	session.Options.MaxAge = -1
	session.Save(r, w)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)

	data := map[string]interface{}{
		"Title":        "Dashboard",
		"ShowNav":      true,
		"UserEmail":    userEmail,
		"TemplateName": "dashboard",
	}

	if err := s.templates.ExecuteTemplate(w, "dashboard", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, _ := s.sessionStore.Get(r, "session")
		userID, ok := session.Values["user_id"].(int64)
		if !ok || userID == 0 {
			http.Redirect(w, r, "/auth/login", http.StatusSeeOther)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleLabels(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	labels, err := s.db.GetAllLabels(ctx, userID)
	if err != nil {
		log.Printf("Failed to load labels: %v", err)
		http.Error(w, "Failed to load labels", http.StatusInternalServerError)
		return
	}

	data := map[string]interface{}{
		"Title":        "Labels",
		"ShowNav":      true,
		"UserEmail":    userEmail,
		"Labels":       labels,
		"TemplateName": "labels",
	}

	if err := s.templates.ExecuteTemplate(w, "labels", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) handleCreateLabel(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	if err := r.ParseForm(); err != nil {
		http.Error(w, "Invalid form", http.StatusBadRequest)
		return
	}

	name := r.FormValue("name")
	description := r.FormValue("description")

	if name == "" {
		http.Error(w, "Label name is required", http.StatusBadRequest)
		return
	}

	ctx := context.Background()
	label := &database.Label{
		UserID:      userID,
		Name:        name,
		Description: description,
		Reasons:     []string{},
	}

	if err := s.db.CreateLabel(ctx, label); err != nil {
		log.Printf("Failed to create label: %v", err)
		http.Error(w, "Failed to create label", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/labels", http.StatusSeeOther)
}

func (s *Server) handleDeleteLabel(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	vars := mux.Vars(r)
	labelID := vars["id"]

	ctx := context.Background()
	if err := s.db.DeleteLabel(ctx, userID, labelID); err != nil {
		log.Printf("Failed to delete label: %v", err)
		http.Error(w, "Failed to delete label", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/labels", http.StatusSeeOther)
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	emails, err := s.db.GetRecentEmails(ctx, userID, 50)
	if err != nil {
		log.Printf("Failed to load email history: %v", err)
		http.Error(w, "Failed to load email history", http.StatusInternalServerError)
		return
	}

	data := map[string]interface{}{
		"Title":        "Email History",
		"ShowNav":      true,
		"UserEmail":    userEmail,
		"Emails":       emails,
		"TemplateName": "history",
	}

	if err := s.templates.ExecuteTemplate(w, "history", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) handleUpdateFeedback(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	if err := r.ParseForm(); err != nil {
		http.Error(w, "Invalid form data", http.StatusBadRequest)
		return
	}

	emailID := r.FormValue("email_id")
	feedback := r.FormValue("feedback")

	if emailID == "" {
		http.Error(w, "Email ID is required", http.StatusBadRequest)
		return
	}

	ctx := context.Background()
	if err := s.db.UpdateEmailFeedback(ctx, userID, emailID, feedback); err != nil {
		log.Printf("Failed to update feedback: %v", err)
		http.Error(w, "Failed to save feedback", http.StatusInternalServerError)
		return
	}

	// Redirect back to history page
	http.Redirect(w, r, "/history", http.StatusSeeOther)
}

func (s *Server) handlePrompts(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	prompts, err := s.db.GetAllSystemPrompts(ctx, userID)
	if err != nil {
		log.Printf("Failed to load system prompts: %v", err)
		http.Error(w, "Failed to load system prompts", http.StatusInternalServerError)
		return
	}

	data := map[string]interface{}{
		"Title":        "System Prompts",
		"ShowNav":      true,
		"UserEmail":    userEmail,
		"Prompts":      prompts,
		"TemplateName": "prompts",
	}

	if err := s.templates.ExecuteTemplate(w, "prompts", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) handleUpdatePrompt(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	if err := r.ParseForm(); err != nil {
		log.Printf("Failed to parse form: %v", err)
		http.Error(w, "Invalid form", http.StatusBadRequest)
		return
	}

	promptType := r.FormValue("type")
	content := r.FormValue("content")

	ctx := context.Background()
	prompt := &database.SystemPrompt{
		UserID:  userID,
		Type:    database.PromptType(promptType),
		Content: content,
	}

	if err := s.db.UpsertSystemPrompt(ctx, prompt); err != nil {
		log.Printf("Failed to update system prompt: %v", err)
		http.Error(w, "Failed to update system prompt", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/prompts", http.StatusSeeOther)
}

func (s *Server) handleInitDefaults(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	if err := s.db.InitializeDefaultPrompts(ctx, userID); err != nil {
		log.Printf("Failed to initialize default prompts: %v", err)
		http.Error(w, "Failed to initialize default prompts", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/prompts", http.StatusSeeOther)
}

func (s *Server) handleMemories(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	memories, err := s.db.GetAllMemories(ctx, userID, 100)
	if err != nil {
		log.Printf("Failed to load memories: %v", err)
		http.Error(w, "Failed to load memories", http.StatusInternalServerError)
		return
	}

	data := map[string]interface{}{
		"Title":        "Memories",
		"ShowNav":      true,
		"UserEmail":    userEmail,
		"Memories":     memories,
		"TemplateName": "memories",
	}

	if err := s.templates.ExecuteTemplate(w, "memories", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) handleGenerateMemory(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	if err := s.memoryService.GenerateDailyMemory(ctx, userID); err != nil {
		log.Printf("Failed to generate memory: %v", err)
		http.Error(w, "Failed to generate memory", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/memories", http.StatusSeeOther)
}

func (s *Server) handleWrapups(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	reports, err := s.db.GetWrapupReportsByUser(ctx, userID, 30) // Last 30 reports
	if err != nil {
		log.Printf("Failed to load wrapup reports: %v", err)
		http.Error(w, "Failed to load wrapup reports", http.StatusInternalServerError)
		return
	}

	data := map[string]interface{}{
		"Title":        "Wrapup Reports",
		"ShowNav":      true,
		"UserEmail":    userEmail,
		"Reports":      reports,
		"TemplateName": "wrapups",
	}

	if err := s.templates.ExecuteTemplate(w, "wrapups", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Error rendering template", http.StatusInternalServerError)
	}
}

func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%s", s.config.ServerHost, s.config.ServerPort)
	log.Printf("Web server starting on http://%s", addr)
	return http.ListenAndServe(addr, s.router)
}
