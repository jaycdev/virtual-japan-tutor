package refdata_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func TestFetcherDownloadsOnceAndReusesTheCache(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("hello"))
	}))
	defer srv.Close()

	f := &refdata.Fetcher{CacheDir: t.TempDir()}
	file := refdata.SourceFile{Name: "sub/file.txt", URL: srv.URL + "/x", SHA256: sum("hello")}

	for range 2 {
		got, err := f.Fetch(context.Background(), file)
		if err != nil {
			t.Fatal(err)
		}
		if got.Checksum != sum("hello") {
			t.Errorf("checksum = %s", got.Checksum)
		}
		if b, _ := os.ReadFile(got.Path); string(b) != "hello" {
			t.Errorf("content = %q", b)
		}
	}
	if hits.Load() != 1 {
		t.Errorf("downloaded %d times, want 1", hits.Load())
	}

	f.Refresh = true
	if _, err := f.Fetch(context.Background(), file); err != nil || hits.Load() != 2 {
		t.Errorf("refresh: err=%v hits=%d", err, hits.Load())
	}
}

func TestFetcherRejectsAChecksumMismatchAndLeavesNothingBehind(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("tampered"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	f := &refdata.Fetcher{CacheDir: dir, Backoff: time.Millisecond}
	_, err := f.Fetch(context.Background(), refdata.SourceFile{Name: "a.txt", URL: srv.URL, SHA256: sum("expected")})
	if err == nil {
		t.Fatal("expected a checksum error")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("cache dir not empty: %v", entries)
	}
}

func TestFetcherUnpinnedFilesRecordTheirChecksum(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("daily build"))
	}))
	defer srv.Close()
	got, err := (&refdata.Fetcher{CacheDir: t.TempDir()}).Fetch(context.Background(), refdata.SourceFile{Name: "d.gz", URL: srv.URL})
	if err != nil || got.Checksum != sum("daily build") {
		t.Errorf("got %+v, err %v", got, err)
	}
}

func TestFetcherSourceDirIsOfflineAndAcceptsPlainFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "JMdict_e"), []byte("<JMdict/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	// No CacheDir and an unusable URL: any network attempt would fail.
	f := &refdata.Fetcher{SourceDir: dir}
	got, err := f.Fetch(context.Background(), refdata.SourceFile{Name: "JMdict_e.gz", URL: "http://127.0.0.1:1/never"})
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(got.Path) != "JMdict_e" || got.Checksum != sum("<JMdict/>") {
		t.Errorf("got %+v", got)
	}

	if _, err := f.Fetch(context.Background(), refdata.SourceFile{Name: "missing.gz"}); err == nil {
		t.Error("expected an error for a file missing from the source dir")
	}
}

func TestEveryDatasetHasLicenceAndPinnedOrFloatingFiles(t *testing.T) {
	for _, d := range refdata.AllDatasets {
		info := refdata.Info(d)
		if info.Licence == "" || info.LicenceURL == "" || info.SourceURL == "" {
			t.Errorf("%s: incomplete info %+v", d, info)
		}
		if d != refdata.Grammar && len(info.Files) == 0 {
			t.Errorf("%s: no files", d)
		}
	}
	if got := len(refdata.Info(refdata.Waller).Files); got != 10 {
		t.Errorf("waller files = %d, want 5 vocab + 5 kanji", got)
	}
	for _, f := range refdata.Info(refdata.Waller).Files {
		if len(f.SHA256) != 64 {
			t.Errorf("%s is not pinned", f.Name)
		}
	}
}

func TestFetcherRefusesADownloadOverItsSizeLimitAndLeavesNothingBehind(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		// Stream without a Content-Length, flushing so the client reads it incrementally.
		chunk := make([]byte, 1024)
		for range 64 {
			if _, err := w.Write(chunk); err != nil {
				return
			}
			w.(http.Flusher).Flush()
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	f := &refdata.Fetcher{CacheDir: dir, Backoff: time.Millisecond}
	_, err := f.Fetch(context.Background(), refdata.SourceFile{Name: "big/data.gz", URL: srv.URL, MaxBytes: 10 * 1024})
	if err == nil {
		t.Fatal("expected a size-limit error")
	}
	if !strings.Contains(err.Error(), "limit") || !strings.Contains(err.Error(), "10240") {
		t.Errorf("error should name the limit, got: %v", err)
	}
	if hits.Load() != 1 {
		t.Errorf("an oversized download was retried (%d requests)", hits.Load())
	}
	var left []string
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, _ error) error {
		if !d.IsDir() {
			left = append(left, p)
		}
		return nil
	})
	if len(left) != 0 {
		t.Errorf("partial files left in the cache: %v", left)
	}
}

func TestFetcherRefusesOnADeclaredContentLengthOverTheLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000000")
		_, _ = w.Write([]byte("short")) // the declared size alone must be enough to refuse
	}))
	defer srv.Close()
	f := &refdata.Fetcher{CacheDir: t.TempDir(), Backoff: time.Millisecond}
	if _, err := f.Fetch(context.Background(), refdata.SourceFile{Name: "a", URL: srv.URL, MaxBytes: 1000}); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("err = %v, want a size-limit error", err)
	}
}

func TestFetcherAcceptsADownloadExactlyAtTheLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("12345"))
	}))
	defer srv.Close()
	f := &refdata.Fetcher{CacheDir: t.TempDir()}
	if _, err := f.Fetch(context.Background(), refdata.SourceFile{Name: "a", URL: srv.URL, MaxBytes: 5}); err != nil {
		t.Fatalf("exactly-at-limit download failed: %v", err)
	}
}

func TestEveryDownloadableFileDeclaresASizeLimit(t *testing.T) {
	for _, d := range refdata.AllDatasets {
		for _, f := range refdata.Info(d).Files {
			if f.MaxBytes <= 0 {
				t.Errorf("%s/%s has no MaxBytes", d, f.Name)
			}
		}
	}
}
