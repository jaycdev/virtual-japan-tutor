// Package auth implements login, session tokens and the request-scoped user identity.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters for new hashes (RFC 9106 "second recommended" profile family:
// memory-hard, ~64 MiB). They are encoded into every hash, so changing them later
// never invalidates stored passwords.
const (
	argonMemoryKiB = 64 * 1024
	argonTime      = 3
	argonThreads   = 2
	argonKeyLen    = 32
	argonSaltLen   = 16

	// Upper bounds applied when verifying a stored hash, so a corrupted or hostile
	// row cannot make us allocate gigabytes.
	maxArgonMemoryKiB = 512 * 1024
	maxArgonTime      = 10
	maxArgonThreads   = 16
)

var errBadHash = errors.New("auth: malformed password hash")

// HashPassword returns an encoded argon2id hash ($argon2id$v=19$m=..,t=..,p=..$salt$hash).
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return encodeHash(argonMemoryKiB, argonTime, argonThreads, salt, key), nil
}

func encodeHash(memory, time uint32, threads uint8, salt, key []byte) string {
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memory, time, threads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// VerifyPassword reports whether password matches the encoded hash, in constant time
// with respect to the derived key. A malformed hash yields (false, error).
func VerifyPassword(password, encoded string) (bool, error) {
	memory, time, threads, salt, want, err := decodeHash(encoded)
	if err != nil {
		return false, err
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

func decodeHash(encoded string) (memory, time uint32, threads uint8, salt, key []byte, err error) {
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return 0, 0, 0, nil, nil, errBadHash
	}
	if parts[2] != "v="+strconv.Itoa(argon2.Version) {
		return 0, 0, 0, nil, nil, errBadHash
	}
	var m, t, p uint64
	fields := strings.Split(parts[3], ",")
	if len(fields) != 3 {
		return 0, 0, 0, nil, nil, errBadHash
	}
	for i, prefix := range []string{"m=", "t=", "p="} {
		v, ok := strings.CutPrefix(fields[i], prefix)
		if !ok {
			return 0, 0, 0, nil, nil, errBadHash
		}
		n, perr := strconv.ParseUint(v, 10, 32)
		if perr != nil {
			return 0, 0, 0, nil, nil, errBadHash
		}
		switch i {
		case 0:
			m = n
		case 1:
			t = n
		case 2:
			p = n
		}
	}
	if m == 0 || m > maxArgonMemoryKiB || t == 0 || t > maxArgonTime || p == 0 || p > maxArgonThreads {
		return 0, 0, 0, nil, nil, errBadHash
	}
	b64 := base64.RawStdEncoding
	if salt, err = b64.DecodeString(parts[4]); err != nil || len(salt) == 0 {
		return 0, 0, 0, nil, nil, errBadHash
	}
	if key, err = b64.DecodeString(parts[5]); err != nil || len(key) == 0 {
		return 0, 0, 0, nil, nil, errBadHash
	}
	return uint32(m), uint32(t), uint8(p), salt, key, nil
}
