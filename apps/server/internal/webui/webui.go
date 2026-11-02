// Package webui serves the built web app (the Vite output) from the same
// origin as the API, so a self-hoster deploys one container and opens one URL.
//
// It sits in front of the API handler: a GET or HEAD for a file that exists in
// the web directory is served from disk, everything else (every API route,
// every unknown path, every other method) goes to the API untouched. The web
// app has no client-side routes, so there is no index.html fallback: an
// unknown path is the API's 404, not a blank page.
package webui

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// Handler serves files from dir and delegates everything else to api. It
// fails if dir has no index.html, so a mis-built image stops at startup
// instead of serving a 404 at "/".
func Handler(dir string, api http.Handler) (http.Handler, error) {
	root := os.DirFS(dir)
	info, err := fs.Stat(root, "index.html")
	if err != nil {
		return nil, fmt.Errorf("web directory %q has no index.html: %w", dir, err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("web directory %q: index.html is a directory", dir)
	}
	return &handler{root: root, api: api}, nil
}

type handler struct {
	root fs.FS
	api  http.Handler
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.api.ServeHTTP(w, r)
		return
	}
	name, ok := fileName(r.URL.Path)
	if !ok {
		h.api.ServeHTTP(w, r)
		return
	}
	f, err := h.root.Open(name)
	if err != nil {
		h.api.ServeHTTP(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		h.api.ServeHTTP(w, r)
		return
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		h.api.ServeHTTP(w, r)
		return
	}

	hd := w.Header()
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Referrer-Policy", "same-origin")
	hd.Set("X-Frame-Options", "DENY")
	if strings.HasPrefix(name, "assets/") {
		// Vite names these by content hash, so they never change under one name.
		hd.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		hd.Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), rs)
}

// fileName maps a request path to a slash-separated name inside the web
// directory. "/" is the app's index.html. Paths that are not valid fs names
// (parent references, empty elements) are not files.
func fileName(p string) (string, bool) {
	if p == "/" {
		return "index.html", true
	}
	name := strings.TrimPrefix(p, "/")
	if name == "" || strings.HasSuffix(name, "/") || path.Clean(name) != name || !fs.ValidPath(name) {
		return "", false
	}
	return name, true
}
