// Package llm is a transport-only client for OpenAI-compatible chat completion endpoints
// (OpenAI, OpenRouter, LiteLLM, Ollama, vLLM, ...). It holds no domain logic: callers supply
// the messages and interpret the result.
package llm

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// NormalizeBaseURL validates and canonicalises an endpoint base URL: http or https only,
// no credentials/query/fragment, lowercase scheme and host, no trailing slash. A bare host
// (empty path) gets "/v1" appended; a pasted ".../chat/completions" is cut back to its base.
//
// Private, LAN and loopback hosts are deliberately allowed: this is a single-user,
// self-hosted tool and local endpoints (Ollama, vLLM) are a primary use case.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("base URL is required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("base URL is not a valid URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if (scheme != "http" && scheme != "https") || u.Host == "" {
		return "", errors.New("base URL must be an absolute http:// or https:// URL")
	}
	if u.User != nil {
		return "", errors.New("base URL must not contain credentials; use the API key field")
	}
	if u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", errors.New("base URL must not contain a query string or fragment")
	}
	if u.Hostname() == "" {
		return "", errors.New("base URL has no host")
	}

	path := strings.TrimRight(u.EscapedPath(), "/")
	path = strings.TrimSuffix(path, "/chat/completions")
	path = strings.TrimRight(path, "/")
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	if path == "" {
		path = "/v1"
	}
	return fmt.Sprintf("%s://%s%s", scheme, strings.ToLower(u.Host), path), nil
}
