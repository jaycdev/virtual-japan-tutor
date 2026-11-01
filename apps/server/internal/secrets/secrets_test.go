package secrets_test

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

func key(b byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{b}, 32)) }

func newBox(t *testing.T, k string) *secrets.Box {
	t.Helper()
	box, err := secrets.New(k)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return box
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	box := newBox(t, key(1))
	for _, plain := range []string{"marumori-api-key", "", "日本語のキー🔑", strings.Repeat("x", 10_000)} {
		ct, err := box.Encrypt(plain)
		if err != nil {
			t.Fatalf("Encrypt(%q): %v", plain, err)
		}
		got, err := box.Decrypt(ct)
		if err != nil {
			t.Fatalf("Decrypt: %v", err)
		}
		if got != plain {
			t.Fatalf("round trip = %q, want %q", got, plain)
		}
	}
}

func TestCiphertextIsVersionedAndHidesPlaintext(t *testing.T) {
	ct, err := newBox(t, key(1)).Encrypt("super-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ct, "v1:") {
		t.Fatalf("ciphertext %q lacks the v1: version prefix", ct)
	}
	if strings.Contains(ct, "super-secret-value") {
		t.Fatalf("ciphertext leaks plaintext: %q", ct)
	}
}

func TestEncryptingTwiceGivesDifferentCiphertexts(t *testing.T) {
	box := newBox(t, key(1))
	a, _ := box.Encrypt("same")
	b, _ := box.Encrypt("same")
	if a == b {
		t.Fatal("nonce reuse: identical ciphertexts for identical plaintext")
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	ct, _ := newBox(t, key(1)).Encrypt("secret")
	if _, err := newBox(t, key(2)).Decrypt(ct); err == nil {
		t.Fatal("Decrypt with the wrong key succeeded")
	}
}

func TestDecryptRejectsTamperedCiphertext(t *testing.T) {
	box := newBox(t, key(1))
	ct, _ := box.Encrypt("secret")

	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ct, "v1:"))
	if err != nil {
		t.Fatal(err)
	}
	// Flip a bit in the nonce, in the body and in the GCM tag: each must be detected.
	for _, idx := range []int{0, 13, len(raw) - 1} {
		mut := bytes.Clone(raw)
		mut[idx] ^= 0x01
		if _, err := box.Decrypt("v1:" + base64.StdEncoding.EncodeToString(mut)); err == nil {
			t.Fatalf("tampering with byte %d was not detected", idx)
		}
	}
}

func TestDecryptRejectsMalformedInput(t *testing.T) {
	box := newBox(t, key(1))
	for name, in := range map[string]string{
		"empty":           "",
		"no version":      "abcd",
		"unknown version": "v9:" + base64.StdEncoding.EncodeToString(make([]byte, 40)),
		"bad base64":      "v1:!!!not-base64!!!",
		"too short":       "v1:" + base64.StdEncoding.EncodeToString(make([]byte, 5)),
	} {
		if _, err := box.Decrypt(in); err == nil {
			t.Errorf("%s: Decrypt(%q) succeeded, want error", name, in)
		}
	}
}

func TestNewRejectsInvalidKeys(t *testing.T) {
	for name, k := range map[string]string{
		"empty":         "",
		"not base64":    "%%%",
		"too short":     base64.StdEncoding.EncodeToString(make([]byte, 16)),
		"too long":      base64.StdEncoding.EncodeToString(make([]byte, 33)),
		"whitespace":    "   ",
		"hex not b64":   strings.Repeat("ab", 32), // 64 hex chars decode to 48 bytes
		"std w/o 32 b.": "c2hvcnQ=",
	} {
		_, err := secrets.New(k)
		if err == nil {
			t.Errorf("%s: New(%q) succeeded, want error", name, k)
			continue
		}
		if strings.Contains(err.Error(), k) && k != "" && strings.TrimSpace(k) != "" {
			t.Errorf("%s: error message leaks the key material: %v", name, err)
		}
	}
}

func TestNewAcceptsPaddedStdBase64KeyWithSurroundingWhitespace(t *testing.T) {
	if _, err := secrets.New("  " + key(7) + "\n"); err != nil {
		t.Fatalf("New: %v", err)
	}
}
