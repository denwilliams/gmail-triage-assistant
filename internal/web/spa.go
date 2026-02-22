package web

import (
	"io/fs"
	"net/http"
	"strings"
)

// spaHandler serves the React SPA. It tries to serve the requested file
// from the embedded filesystem. If the file doesn't exist (i.e. it's a
// client-side route), it falls back to serving index.html.
type spaHandler struct {
	staticFS    http.Handler
	staticFiles fs.FS
}

func newSPAHandler(distFS fs.FS) *spaHandler {
	return &spaHandler{
		staticFS:    http.FileServer(http.FS(distFS)),
		staticFiles: distFS,
	}
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Clean the path
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	// Try to open the file
	f, err := h.staticFiles.Open(path)
	if err != nil {
		// File doesn't exist — serve index.html for client-side routing
		r.URL.Path = "/index.html"
		h.staticFS.ServeHTTP(w, r)
		return
	}
	f.Close()

	// File exists — serve it directly
	h.staticFS.ServeHTTP(w, r)
}
