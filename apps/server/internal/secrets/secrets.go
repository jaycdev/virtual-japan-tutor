// Package secrets encrypts small secrets (third-party API keys) for storage at rest.
//
// Ciphertexts are AES-256-GCM, formatted as "v1:" + base64(nonce || sealed). The version
// prefix lets a future key (or algorithm) rotation coexist with old rows: decide by prefix.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	// KeyEnv is the environment variable holding the base64 encryption key.
	KeyEnv  = "SECRETS_KEY"
	keySize = 32 // AES-256
	v1      = "v1:"
)

// ErrInvalidCiphertext is returned for anything Decrypt cannot authenticate and open:
// malformed input, unknown version, wrong key or tampering. Callers cannot (and should not)
// tell these apart.
var ErrInvalidCiphertext = errors.New("secrets: invalid ciphertext")

// Box encrypts and decrypts strings with one key.
type Box struct{ aead cipher.AEAD }

// ParseKey decodes a standard-base64 32-byte key (surrounding whitespace is ignored).
// Errors never include the key material.
func ParseKey(b64 string) ([]byte, error) {
	b64 = strings.TrimSpace(b64)
	if b64 == "" {
		return nil, fmt.Errorf("%s is required: a base64-encoded 32-byte key (generate one with `openssl rand -base64 32`)", KeyEnv)
	}
	key, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("%s is not valid base64 (generate one with `openssl rand -base64 32`)", KeyEnv)
	}
	if len(key) != keySize {
		return nil, fmt.Errorf("%s must decode to exactly %d bytes, got %d (generate one with `openssl rand -base64 32`)", KeyEnv, keySize, len(key))
	}
	return key, nil
}

// New builds a Box from a base64-encoded 32-byte key.
func New(keyB64 string) (*Box, error) {
	key, err := ParseKey(keyB64)
	if err != nil {
		return nil, err
	}
	return NewFromKey(key)
}

// NewFromKey builds a Box from a raw 32-byte key.
func NewFromKey(key []byte) (*Box, error) {
	if len(key) != keySize {
		return nil, fmt.Errorf("secrets: key must be %d bytes, got %d", keySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Encrypt seals plaintext under a fresh random nonce.
func (b *Box) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("secrets: nonce: %w", err)
	}
	sealed := b.aead.Seal(nonce, nonce, []byte(plaintext), []byte(v1))
	return v1 + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt opens a value produced by Encrypt. The version prefix is bound into the
// authenticated data, so it cannot be altered independently of the ciphertext.
func (b *Box) Decrypt(ciphertext string) (string, error) {
	enc, ok := strings.CutPrefix(ciphertext, v1)
	if !ok {
		return "", ErrInvalidCiphertext
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil || len(raw) < b.aead.NonceSize()+b.aead.Overhead() {
		return "", ErrInvalidCiphertext
	}
	nonce, sealed := raw[:b.aead.NonceSize()], raw[b.aead.NonceSize():]
	plain, err := b.aead.Open(nil, nonce, sealed, []byte(v1))
	if err != nil {
		return "", ErrInvalidCiphertext
	}
	return string(plain), nil
}
