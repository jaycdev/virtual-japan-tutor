// Package webui serves the built web app (the Expo web export) from the same
// origin as the API, so a self-hoster deploys one container and opens one URL.
//
// It sits in front of the API handler: a GET or HEAD for a file that exists in
// the web directory is served from disk; every API route, every other method
// and every path that is not a file goes to the API. One exception (#51): the
// Expo app has client-side routes (web URLs like /stories/:id that must
// survive a reload), so a page navigation — GET/HEAD whose path names no file
// type and whose Accept asks for text/html — that misses the disk gets
// index.html, and the app's router takes the URL from there. API clients are
// unaffected: openapi-fetch sends Accept: */* (and curl/wget the same), so
// every API call, including ones on app-shaped paths like GET /stories/123,
// still reaches the API. Asset misses — paths with a file extension, like a
// hashed bundle name from a superseded release — get the API's JSON 404,
// never the app shell.
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
// instead of serving a 404 (or an empty fallback) at "/".
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
		// A trailing slash ("/stories/") is not a valid fs name, but it is
		// still an extension-less client-side route: run the same
		// page-vs-API decision on the trimmed path (#51 review S3).
		if h.serveShellForSlashRoute(w, r) {
			return
		}
		h.api.ServeHTTP(w, r)
		return
	}
	if h.serveFile(w, r, name) {
		return
	}
	// File miss on a path that names no file type: the answer now depends
	// on Accept (app shell for page loads, API JSON for everything else),
	// so a cache keyed on the URL alone must not mix the two — both answers
	// say Vary: Accept (#51 review S1).
	if path.Ext(name) == "" {
		w.Header().Set("Vary", "Accept")
	}
	if pageRequest(r, name) {
		if h.serveFile(w, r, "index.html") {
			return
		}
	}
	h.api.ServeHTTP(w, r)
}

// serveFile writes name from the web directory and reports whether it served
// it. Missing, directory, and non-seekable entries return false so the caller
// can decide between the app shell and the API.
func (h *handler) serveFile(w http.ResponseWriter, r *http.Request, name string) bool {
	f, err := h.root.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}

	hd := w.Header()
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Referrer-Policy", "same-origin")
	hd.Set("X-Frame-Options", "DENY")
	if strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "_expo/") {
		// Expo content-hashes these names, so they never change under one name.
		hd.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		hd.Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), rs)
	return true
}

// pageRequest reports a browser document load: Accept asks for HTML and the
// path names no file type. fetch/openapi-fetch and curl/wget do not ask for
// text/html, so API and health checks never match here; a path like
// /assets/index-deadbeef.js names a file type, so stale asset references 404
// through the API instead of being papered over with index.html.
func pageRequest(r *http.Request, name string) bool {
	if !strings.Contains(r.Header.Get("Accept"), "text/html") {
		return false
	}
	return path.Ext(name) == ""
}

// serveShellForSlashRoute covers trailing-slash deep links like /stories/:
// fileName rejects the trailing slash before any disk lookup, but the path
// still names no file type — a browser wants the app shell for it, while
// Accept: */* stays the API's business (its 404).
func (h *handler) serveShellForSlashRoute(w http.ResponseWriter, r *http.Request) bool {
	trimmed, ok := fileName(strings.TrimSuffix(r.URL.Path, "/"))
	if !ok || trimmed == "index.html" || path.Ext(trimmed) != "" {
		return false
	}
	w.Header().Set("Vary", "Accept")
	return pageRequest(r, trimmed) && h.serveFile(w, r, "index.html")
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
