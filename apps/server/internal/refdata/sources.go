package refdata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Dataset names one of the open datasets the import loads.
type Dataset string

const (
	JMdict    Dataset = "jmdict"
	Kanjidic2 Dataset = "kanjidic2"
	Waller    Dataset = "waller"
	Kanjium   Dataset = "kanjium"
	Grammar   Dataset = "grammar"
)

// AllDatasets is the order a full import runs in: the JLPT lists are matched
// against what JMdict and KANJIDIC2 already loaded, so they come after.
var AllDatasets = []Dataset{JMdict, Kanjidic2, Waller, Kanjium, Grammar}

func ParseDataset(s string) (Dataset, error) {
	for _, d := range AllDatasets {
		if string(d) == s {
			return d, nil
		}
	}
	return "", fmt.Errorf("unknown dataset %q (want one of %v)", s, AllDatasets)
}

// SourceFile is one downloadable file of a dataset.
type SourceFile struct {
	// Name is the path relative to the cache or --source-dir directory.
	Name string
	URL  string
	// SHA256 pins the exact content (lower-case hex). Empty for files the
	// publisher updates in place (EDRDG regenerates its files daily and
	// publishes no checksums); those are checksummed after download and the
	// checksum is recorded in import_runs.
	SHA256 string
	// MaxBytes is the most a download of this file may be; anything larger is refused
	// and discarded. Set to roughly 4x the size at the time of writing, so normal
	// growth passes but a runaway or hostile response cannot fill the disk.
	// Zero means defaultMaxDownloadBytes.
	MaxBytes int64
}

const defaultMaxDownloadBytes = 256 << 20

// errTooLarge marks a download that exceeded its size limit; retrying cannot help.
var errTooLarge = errors.New("download exceeds its size limit")

// DatasetInfo describes where a dataset comes from and under what terms.
// THIRD_PARTY_NOTICES.md carries the full attribution text.
type DatasetInfo struct {
	Dataset    Dataset
	Title      string
	SourceURL  string // the page or repository the data comes from
	Licence    string
	LicenceURL string
	Files      []SourceFile // empty for the grammar CSV, which is read from the repo
}

const (
	edrdgLicence    = "CC BY-SA 4.0"
	edrdgLicenceURL = "https://www.edrdg.org/edrdg/licence.html"
	wallerCommitVoc = "5049157b026f69ded6170f12bcb1620380920d25" // mugiten/jadb
	wallerCommitKan = "4358f932937ad0232194a36e9f4f875094910c6b" // Bluskyo/JLPT_Vocabulary
	kanjiumCommit   = "685d4d723d6d20bf9beb169103aeac188eb067ad" // mifunetoshiro/kanjium
)

var wallerVocabSHA = map[string]string{
	"n1": "ffe70f7e301ce04d49dea2b5115ed9b4e84cdb0476b9e60e2451bed0e10e871d",
	"n2": "c0d6aae3cc125fcf588853a4381dc24d4785e1f3960727038d6d6f3a8d976e15",
	"n3": "a7ec6415807bd05ef53955d784f9faf3aa8fde078e023d5499a88148a33cda21",
	"n4": "1616e19e1dfe0dc067e6962527e10c618860c5dbe92200056bfbf5873e781405",
	"n5": "a433d648068a5d75d562d23852021a1073e44b188db8bb37cc92340d0af9d6ee",
}

var wallerKanjiSHA = map[string]string{
	"n1": "ae0e4f451f4eae702c5d99d112e6910250a59568101a2639b9e574536d8d98ee",
	"n2": "3678f64b6bccaca53686f31e9c2e4825e85ef5173d2312c134008dfcfa824f95",
	"n3": "f32b1ac7e02efcbf29c46e9dfb75bdac9526254ed448b245d4cc3915410754ef",
	"n4": "42a8993084e741d6885147f181a886a5e2d515e137a8433cbf2820f8c5086a1c",
	"n5": "eb0b1f3c077f62b325a096562461bae6c5d4fb21015637210a3a3ef91713e651",
}

// WallerVocabFile and WallerKanjiFile name the cache files for a level.
func WallerVocabFile(l Level) string { return "waller/" + strings.ToLower(string(l)) + "_vocab.csv" }
func WallerKanjiFile(l Level) string { return "waller/" + strings.ToLower(string(l)) + "_kanji.csv" }

// Info returns the source description for a dataset.
func Info(d Dataset) DatasetInfo {
	switch d {
	case JMdict:
		return DatasetInfo{
			Dataset: JMdict, Title: "JMdict (English glosses)",
			SourceURL: "https://www.edrdg.org/jmdict/j_jmdict.html",
			Licence:   edrdgLicence, LicenceURL: edrdgLicenceURL,
			// ~10 MB today (JMdict_e.gz, 2026-11).
			Files: []SourceFile{{Name: "JMdict_e.gz", URL: "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz", MaxBytes: 48 << 20}},
		}
	case Kanjidic2:
		return DatasetInfo{
			Dataset: Kanjidic2, Title: "KANJIDIC2",
			SourceURL: "https://www.edrdg.org/wiki/index.php/KANJIDIC_Project",
			Licence:   edrdgLicence, LicenceURL: edrdgLicenceURL,
			// ~1.4 MB today.
			Files: []SourceFile{{Name: "kanjidic2.xml.gz", URL: "https://www.edrdg.org/pub/Nihongo/kanjidic2.xml.gz", MaxBytes: 8 << 20}},
		}
	case Waller:
		// tanos.co.uk, the original home of the lists, did not resolve when this
		// import was written, so the files are fetched from pinned commits of two
		// public conversions of Waller's lists.
		info := DatasetInfo{
			Dataset: Waller, Title: "Jonathan Waller's JLPT vocabulary and kanji lists",
			SourceURL: "https://www.tanos.co.uk/jlpt/",
			Licence:   "CC BY", LicenceURL: "https://creativecommons.org/licenses/by/4.0/",
		}
		for _, l := range Levels {
			n := strings.ToLower(string(l))
			info.Files = append(info.Files,
				SourceFile{
					Name:   WallerVocabFile(l),
					URL:    "https://git.pvv.ntnu.no/mugiten/jadb/raw/commit/" + wallerCommitVoc + "/data/tanos-jlpt/" + n + ".csv",
					SHA256: wallerVocabSHA[n],
					// Largest list (N1 vocabulary) is ~175 KB today.
					MaxBytes: 2 << 20,
				},
				SourceFile{
					Name:   WallerKanjiFile(l),
					URL:    "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/" + wallerCommitKan + "/data/kanji/parsedData/" + n + "_kanji.csv",
					SHA256: wallerKanjiSHA[n],
					// Small CSV lists, like the vocabulary ones.
					MaxBytes: 2 << 20,
				})
		}
		return info
	case Kanjium:
		return DatasetInfo{
			Dataset: Kanjium, Title: "Kanjium pitch accents",
			SourceURL: "https://github.com/mifunetoshiro/kanjium",
			Licence:   "CC BY-SA 4.0", LicenceURL: "https://creativecommons.org/licenses/by-sa/4.0/",
			Files: []SourceFile{{
				Name:     "accents.txt",
				URL:      "https://raw.githubusercontent.com/mifunetoshiro/kanjium/" + kanjiumCommit + "/data/source_files/raw/accents.txt",
				SHA256:   "8bd0dd127dab32ceec94cb03ab1ba6b68858ea73421dfa1731af2f373deb4f20",
				MaxBytes: 16 << 20, // ~3.1 MB today
			}},
		}
	case Grammar:
		return DatasetInfo{
			Dataset: Grammar, Title: "JLPT Grammar spreadsheet (Grammar Catalogue)",
			SourceURL: "data/grammar/jlpt-grammar.csv in this repository (ADR-0005)",
			Licence:   "Full rights held by the project owner (ADR-0005)", LicenceURL: "docs/adr/0005-grammar-catalogue-source.md",
		}
	}
	return DatasetInfo{Dataset: d}
}

// FetchedFile is a source file made available locally.
type FetchedFile struct {
	SourceFile
	Path      string
	Checksum  string    // sha256 of the content, lower-case hex
	FetchedAt time.Time // download time, or the file's modification time for local files
}

// Fetcher gets source files onto local disk.
type Fetcher struct {
	// SourceDir, when set, is an offline directory of pre-downloaded files laid
	// out like the cache. Nothing is downloaded and pinned checksums are only
	// warned about, since the files are the operator's own.
	SourceDir string
	// CacheDir receives downloads. Files already there are reused.
	CacheDir string
	// Refresh re-downloads files even when they are cached.
	Refresh bool
	Client  *http.Client
	Log     *slog.Logger
	// Backoff is the base wait between download attempts (default 2s; attempt n waits n times this).
	Backoff time.Duration
}

func (f *Fetcher) backoff() time.Duration {
	if f.Backoff > 0 {
		return f.Backoff
	}
	return 2 * time.Second
}

func (f *Fetcher) log() *slog.Logger {
	if f.Log != nil {
		return f.Log
	}
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// Fetch returns a local copy of file, downloading it if needed.
func (f *Fetcher) Fetch(ctx context.Context, file SourceFile) (FetchedFile, error) {
	if f.SourceDir != "" {
		return f.fromSourceDir(file)
	}
	if f.CacheDir == "" {
		return FetchedFile{}, errors.New("no cache directory configured")
	}
	path := filepath.Join(f.CacheDir, filepath.FromSlash(file.Name))
	if !f.Refresh {
		if ff, err := localFile(file, path); err == nil {
			if file.SHA256 != "" && ff.Checksum != file.SHA256 {
				return FetchedFile{}, fmt.Errorf("%s: cached file has checksum %s, want %s; delete it or use --refresh", path, ff.Checksum, file.SHA256)
			}
			f.log().Info("using cached file", "file", file.Name)
			return ff, nil
		}
	}
	if err := f.download(ctx, file, path); err != nil {
		return FetchedFile{}, err
	}
	return localFile(file, path)
}

func (f *Fetcher) fromSourceDir(file SourceFile) (FetchedFile, error) {
	// The plain XML is accepted wherever a .gz is expected.
	for _, name := range []string{file.Name, strings.TrimSuffix(file.Name, ".gz")} {
		path := filepath.Join(f.SourceDir, filepath.FromSlash(name))
		ff, err := localFile(file, path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return FetchedFile{}, err
		}
		if file.SHA256 != "" && ff.Checksum != file.SHA256 {
			f.log().Warn("source file differs from the pinned version", "file", name, "sha256", ff.Checksum, "pinned", file.SHA256)
		}
		return ff, nil
	}
	return FetchedFile{}, fmt.Errorf("source dir %s has no %s", f.SourceDir, file.Name)
}

func localFile(file SourceFile, path string) (FetchedFile, error) {
	st, err := os.Stat(path)
	if err != nil {
		return FetchedFile{}, err
	}
	sum, err := checksumFile(path)
	if err != nil {
		return FetchedFile{}, err
	}
	return FetchedFile{SourceFile: file, Path: path, Checksum: sum, FetchedAt: st.ModTime().UTC()}, nil
}

func checksumFile(path string) (string, error) {
	fh, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer fh.Close()
	h := sha256.New()
	if _, err := io.Copy(h, fh); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (f *Fetcher) download(ctx context.Context, file SourceFile, path string) error {
	client := f.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Minute}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * f.backoff()):
			}
		}
		f.log().Info("downloading", "file", file.Name, "url", file.URL, "attempt", attempt)
		if lastErr = f.downloadOnce(ctx, client, file, path); lastErr == nil {
			return nil
		}
		f.log().Warn("download failed", "file", file.Name, "err", lastErr)
		if errors.Is(lastErr, errTooLarge) {
			break // the server will send the same oversized file again
		}
	}
	return fmt.Errorf("download %s: %w", file.URL, lastErr)
}

func (f *Fetcher) downloadOnce(ctx context.Context, client *http.Client, file SourceFile, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, file.URL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %s", resp.Status)
	}
	limit := file.MaxBytes
	if limit <= 0 {
		limit = defaultMaxDownloadBytes
	}
	if resp.ContentLength > limit {
		return fmt.Errorf("%w: server declares %d bytes, limit is %d", errTooLarge, resp.ContentLength, limit)
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	// Read one byte past the limit so "exactly at the limit" passes and "over" is detected.
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(resp.Body, limit+1))
	if err != nil {
		tmp.Close()
		return err
	}
	if n > limit {
		tmp.Close()
		return fmt.Errorf("%w: more than %d bytes received", errTooLarge, limit)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); file.SHA256 != "" && got != file.SHA256 {
		return fmt.Errorf("checksum mismatch: got %s, want %s", got, file.SHA256)
	}
	return os.Rename(tmp.Name(), path)
}
