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

	// Labels management (requires auth)
	s.router.HandleFunc("/labels", s.requireAuth(s.handleLabels)).Methods("GET")
	s.router.HandleFunc("/labels/create", s.requireAuth(s.handleCreateLabel)).Methods("POST")
	s.router.HandleFunc("/labels/{id}/delete", s.requireAuth(s.handleDeleteLabel)).Methods("POST")

	// Email history (requires auth)
	s.router.HandleFunc("/history", s.requireAuth(s.handleHistory)).Methods("GET")
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
			<ul>
				<li><a href="/dashboard">Dashboard</a></li>
				<li><a href="/labels">Labels</a></li>
				<li><a href="/history">History</a></li>
				<li>%s</li>
				<li><a href="/auth/logout">Logout</a></li>
			</ul>
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

func (s *Server) handleLabels(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userEmail := session.Values["user_email"].(string)
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()
	labels, err := s.db.GetAllLabels(ctx, userID)
	if err != nil {
		http.Error(w, "Failed to load labels", http.StatusInternalServerError)
		return
	}

	labelsHTML := ""
	for _, label := range labels {
		labelsHTML += fmt.Sprintf(`
		<tr>
			<td><strong>%s</strong></td>
			<td>%s</td>
			<td>
				<form method="POST" action="/labels/%d/delete" style="margin: 0;">
					<button type="submit" class="secondary" onclick="return confirm('Delete this label?')">Delete</button>
				</form>
			</td>
		</tr>`, label.Name, label.Description, label.ID)
	}

	if labelsHTML == "" {
		labelsHTML = `<tr><td colspan="3"><em>No labels configured yet</em></td></tr>`
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>Labels - Gmail Triage Assistant</title>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
</head>
<body>
	<main class="container">
		<nav>
			<ul><li><strong>Gmail Triage</strong></li></ul>
			<ul>
				<li><a href="/dashboard">Dashboard</a></li>
				<li><a href="/labels">Labels</a></li>
				<li><a href="/history">History</a></li>
				<li>%s</li>
				<li><a href="/auth/logout">Logout</a></li>
			</ul>
		</nav>
		<article>
			<h2>Label Management</h2>
			<p>Configure labels that the AI can apply to your emails.</p>

			<h3>Create New Label</h3>
			<form method="POST" action="/labels/create">
				<label>
					Label Name
					<input type="text" name="name" placeholder="e.g., Work, Personal, Newsletter" required>
				</label>
				<label>
					Description (helps AI understand when to use this label)
					<textarea name="description" placeholder="e.g., Work-related emails from colleagues and clients" rows="3"></textarea>
				</label>
				<button type="submit">Create Label</button>
			</form>
		</article>

		<article>
			<h3>Your Labels</h3>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Description</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					%s
				</tbody>
			</table>
		</article>
	</main>
</body>
</html>`, userEmail, labelsHTML)

	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
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

	emailsHTML := ""
	for _, email := range emails {
		// Format labels as badges
		labelsHTML := ""
		if len(email.LabelsApplied) == 0 {
			labelsHTML = `<em style="color: #666;">No labels</em>`
		} else {
			for _, label := range email.LabelsApplied {
				labelsHTML += fmt.Sprintf(`<span style="display: inline-block; background: #0066cc; color: white; padding: 2px 8px; border-radius: 4px; margin: 2px; font-size: 0.85em;">%s</span> `, label)
			}
		}

		// Format keywords
		keywordsHTML := ""
		for _, keyword := range email.Keywords {
			keywordsHTML += fmt.Sprintf(`<code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; margin: 2px; font-size: 0.85em;">%s</code> `, keyword)
		}

		// Archive badge
		archiveBadge := ""
		if email.BypassedInbox {
			archiveBadge = `<span style="display: inline-block; background: #ff6b6b; color: white; padding: 2px 8px; border-radius: 4px; margin-left: 8px; font-size: 0.85em;">Archived</span>`
		}

		emailsHTML += fmt.Sprintf(`
		<article style="margin-bottom: 1.5rem; border-left: 3px solid #0066cc; padding-left: 1rem;">
			<h4 style="margin-bottom: 0.5rem;">%s %s</h4>
			<p style="color: #666; margin: 0.25rem 0;"><small>From: <strong>%s</strong> | Slug: <code>%s</code></small></p>
			<p style="margin: 0.5rem 0;"><strong>Summary:</strong> %s</p>
			<p style="margin: 0.5rem 0;"><strong>Keywords:</strong> %s</p>
			<p style="margin: 0.5rem 0;"><strong>Labels Applied:</strong> %s</p>
			<p style="color: #888; margin: 0.25rem 0;"><small>Processed: %s</small></p>
		</article>`,
			email.Subject,
			archiveBadge,
			email.FromAddress,
			email.Slug,
			email.Summary,
			keywordsHTML,
			labelsHTML,
			email.ProcessedAt.Format("Jan 2, 2006 3:04 PM"))
	}

	if emailsHTML == "" {
		emailsHTML = `<article><p><em>No emails processed yet. Send yourself an email to see it appear here!</em></p></article>`
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>Email History - Gmail Triage Assistant</title>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
</head>
<body>
	<main class="container">
		<nav>
			<ul><li><strong>Gmail Triage</strong></li></ul>
			<ul>
				<li><a href="/dashboard">Dashboard</a></li>
				<li><a href="/labels">Labels</a></li>
				<li><a href="/history">History</a></li>
				<li>%s</li>
				<li><a href="/auth/logout">Logout</a></li>
			</ul>
		</nav>
		<article>
			<h2>📧 Email Processing History</h2>
			<p>Review AI decisions for recently processed emails (last 50).</p>
		</article>
		%s
	</main>
</body>
</html>`, userEmail, emailsHTML)

	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
}

func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%s", s.config.ServerHost, s.config.ServerPort)
	log.Printf("Web server starting on http://%s", addr)
	return http.ListenAndServe(addr, s.router)
}
