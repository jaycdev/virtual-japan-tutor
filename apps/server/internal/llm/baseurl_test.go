package llm_test

import (
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

func TestNormalizeBaseURL(t *testing.T) {
	ok := map[string]string{
		"https://api.openai.com/v1":                        "https://api.openai.com/v1",
		"https://api.openai.com/v1/":                       "https://api.openai.com/v1",
		"https://api.openai.com":                           "https://api.openai.com/v1",
		"  https://api.openai.com/  ":                      "https://api.openai.com/v1",
		"HTTPS://API.OpenAI.com/v1":                        "https://api.openai.com/v1",
		"http://localhost:11434":                           "http://localhost:11434/v1", // Ollama
		"http://192.168.1.20:8000/v1//":                    "http://192.168.1.20:8000/v1",
		"https://openrouter.ai/api/v1":                     "https://openrouter.ai/api/v1",
		"https://api.groq.com/openai/v1/":                  "https://api.groq.com/openai/v1",
		"http://litellm.internal:4000/v1/chat/completions": "http://litellm.internal:4000/v1", // pasted full endpoint
		"http://[::1]:8080":                                "http://[::1]:8080/v1",
	}
	for in, want := range ok {
		got, err := llm.NormalizeBaseURL(in)
		if err != nil {
			t.Errorf("NormalizeBaseURL(%q) error: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("NormalizeBaseURL(%q) = %q, want %q", in, got, want)
		}
	}

	bad := []string{
		"", "   ", "api.openai.com/v1", "ftp://host/v1", "file:///etc/passwd", "javascript:alert(1)",
		"https://", "https:///v1", "https://user:secret@host/v1", "https://host/v1?key=abc", "https://host/v1#frag",
	}
	for _, in := range bad {
		got, err := llm.NormalizeBaseURL(in)
		if err == nil {
			t.Errorf("NormalizeBaseURL(%q) = %q, want error", in, got)
			continue
		}
		if strings.Contains(err.Error(), "secret") {
			t.Errorf("error for %q leaks URL credentials: %v", in, err)
		}
	}
}
