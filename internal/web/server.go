package web

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/den/gmail-triage-assistant/internal/config"
	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/gorilla/mux"
	"github.com/gorilla/sessions"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/gmail/v1"
	googleoauth2 "google.golang.org/api/oauth2/v2"
	"google.golang.org/api/option"
)

type Server struct {
	router       *mux.Router
	db           *database.DB
	config       *config.Config
	sessionStore *sessions.CookieStore
	oauthConfig  *oauth2.Config
}

func NewServer(db *database.DB, cfg *config.Config) *Server {
	// Generate a random session key in production
	// For now, use a static key (replace in production!)
	store := sessions.NewCookieStore([]byte("replace-with-32-byte-random-key-in-production"))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7, // 7 days
		HttpOnly: true,
		Secure:   false, // Set to true in production with HTTPS
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
		router:       mux.NewRouter(),
		db:           db,
		config:       cfg,
		sessionStore: store,
		oauthConfig:  oauthConfig,
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
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail, ok := session.Values["user_email"].(string)

	if ok && userEmail != "" {
		http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
		return
	}

	html := `<!DOCTYPE html>
<html>
<head>
	<title>Gmail Triage Assistant</title>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
</head>
<body>
	<main class="container">
		<article>
			<h1>📧 Gmail Triage Assistant</h1>
			<p>AI-powered email management that automatically categorizes and organizes your Gmail inbox.</p>
			<a href="/auth/login" role="button">Sign in with Google</a>
		</article>
	</main>
</body>
</html>`
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
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

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>Dashboard - Gmail Triage Assistant</title>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
</head>
<body>
	<main class="container">
		<nav>
			<ul><li><strong>Gmail Triage</strong></li></ul>
			<ul><li>%s</li><li><a href="/auth/logout">Logout</a></li></ul>
		</nav>
		<article>
			<h2>Dashboard</h2>
			<p>Welcome! Your Gmail inbox is now being monitored.</p>
			<p>Email processing will begin shortly...</p>
		</article>
	</main>
</body>
</html>`, userEmail)

	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
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

func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%s", s.config.ServerHost, s.config.ServerPort)
	log.Printf("Web server starting on http://%s", addr)
	return http.ListenAndServe(addr, s.router)
}
