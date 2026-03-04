package web

import (
	"io"
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
	indexHTML    []byte
}

func newSPAHandler(distFS fs.FS) *spaHandler {
	// Pre-read index.html so we can serve it directly for SPA fallback
	// without going through http.FileServer (which redirects /index.html → /)
	f, err := distFS.Open("index.html")
	if err != nil {
		panic("embedded frontend missing index.html: " + err.Error())
	}
	defer f.Close()
	indexHTML, err := io.ReadAll(f)
	if err != nil {
		panic("failed to read index.html: " + err.Error())
	}

	return &spaHandler{
		staticFS:    http.FileServer(http.FS(distFS)),
		staticFiles: distFS,
		indexHTML:    indexHTML,
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
		// File doesn't exist — serve index.html directly for client-side routing
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(h.indexHTML)
		return
	}
	f.Close()

	// File exists — serve it directly
	h.staticFS.ServeHTTP(w, r)
}
