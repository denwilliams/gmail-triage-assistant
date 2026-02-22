package web

import (
	"context"
	"fmt"
	"io/fs"
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

type Server struct {
	router        *mux.Router
	db            *database.DB
	config        *config.Config
	sessionStore  *sessions.CookieStore
	oauthConfig   *oauth2.Config
	memoryService *memory.Service
	frontendFS    fs.FS
}

func NewServer(db *database.DB, cfg *config.Config, memoryService *memory.Service, frontendFS fs.FS) *Server {
	store := sessions.NewCookieStore([]byte(cfg.SessionSecret))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7, // 7 days
		HttpOnly: true,
		Secure:   cfg.SessionSecret != config.DefaultSessionSecret,
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

	s := &Server{
		router:        mux.NewRouter(),
		db:            db,
		config:        cfg,
		sessionStore:  store,
		oauthConfig:   oauthConfig,
		memoryService: memoryService,
		frontendFS:    frontendFS,
	}

	s.routes()
	return s
}

func (s *Server) routes() {
	// OAuth routes (server-side redirects, keep as-is)
	s.router.HandleFunc("/auth/login", s.handleLogin).Methods("GET")
	s.router.HandleFunc("/auth/callback", s.handleCallback).Methods("GET")
	s.router.HandleFunc("/auth/logout", s.handleLogout).Methods("GET")

	// JSON API routes
	api := s.router.PathPrefix("/api/v1").Subrouter()

	api.HandleFunc("/auth/me", s.requireAuthAPI(s.handleAPIAuthMe)).Methods("GET")

	api.HandleFunc("/labels", s.requireAuthAPI(s.handleAPIGetLabels)).Methods("GET")
	api.HandleFunc("/labels", s.requireAuthAPI(s.handleAPICreateLabel)).Methods("POST")
	api.HandleFunc("/labels/{id}", s.requireAuthAPI(s.handleAPIUpdateLabel)).Methods("PUT")
	api.HandleFunc("/labels/{id}", s.requireAuthAPI(s.handleAPIDeleteLabel)).Methods("DELETE")

	api.HandleFunc("/emails", s.requireAuthAPI(s.handleAPIGetEmails)).Methods("GET")
	api.HandleFunc("/emails/{id}/feedback", s.requireAuthAPI(s.handleAPIUpdateFeedback)).Methods("PUT")

	api.HandleFunc("/prompts", s.requireAuthAPI(s.handleAPIGetPrompts)).Methods("GET")
	api.HandleFunc("/prompts", s.requireAuthAPI(s.handleAPIUpdatePrompt)).Methods("PUT")
	api.HandleFunc("/prompts/defaults", s.requireAuthAPI(s.handleAPIInitDefaults)).Methods("POST")

	api.HandleFunc("/memories", s.requireAuthAPI(s.handleAPIGetMemories)).Methods("GET")
	api.HandleFunc("/memories/generate", s.requireAuthAPI(s.handleAPIGenerateMemory)).Methods("POST")
	api.HandleFunc("/memories/generate-ai-prompts", s.requireAuthAPI(s.handleAPIGenerateAIPrompts)).Methods("POST")

	api.HandleFunc("/wrapups", s.requireAuthAPI(s.handleAPIGetWrapups)).Methods("GET")

	// SPA fallback — serves React app for all other routes
	spa := newSPAHandler(s.frontendFS)
	s.router.PathPrefix("/").Handler(spa)
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

func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%s", s.config.ServerHost, s.config.ServerPort)
	log.Printf("Web server starting on http://%s", addr)
	return http.ListenAndServe(addr, s.router)
}
