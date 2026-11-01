package auth_test

import (
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
)

func TestHashThenVerify(t *testing.T) {
	hash, err := auth.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := auth.VerifyPassword("correct horse battery staple", hash); err != nil || !ok {
		t.Fatalf("Verify(correct) = %v, %v; want true, nil", ok, err)
	}
	if ok, err := auth.VerifyPassword("Correct horse battery staple", hash); err != nil || ok {
		t.Fatalf("Verify(wrong) = %v, %v; want false, nil", ok, err)
	}
}

func TestHashIsArgon2idWithParamsAndFreshSalt(t *testing.T) {
	a, _ := auth.HashPassword("same password")
	b, _ := auth.HashPassword("same password")
	if a == b {
		t.Fatal("identical hashes: salt is not random")
	}
	// PHC string format: $argon2id$v=19$m=...,t=...,p=...$salt$hash
	if !strings.HasPrefix(a, "$argon2id$v=19$m=") {
		t.Fatalf("hash %q is not an encoded argon2id PHC string", a)
	}
	if strings.Contains(a, "same password") {
		t.Fatal("hash contains the password")
	}
}

// Verify reads its parameters from the stored string, so raising the defaults later
// does not lock out existing users. This hash was produced with m=8,t=1,p=1.
func TestVerifyHonoursParametersEncodedInTheHash(t *testing.T) {
	const legacy = "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHRzb21lc2FsdA$XsIFTmIjhwq4K+F7BioJFbupW1CZL0xskam+rz2ZJfs"
	// Derived independently with: argon2.IDKey("hunter2hunter2", "somesaltsomesalt", 1, 8, 1, 32)
	if ok, err := auth.VerifyPassword("hunter2hunter2", legacy); err != nil || !ok {
		t.Fatalf("Verify(legacy) = %v, %v; want true, nil", ok, err)
	}
}

func TestVerifyRejectsMalformedHashesWithoutPanicking(t *testing.T) {
	for name, h := range map[string]string{
		"empty":         "",
		"garbage":       "not-a-hash",
		"wrong algo":    "$argon2i$v=19$m=8,t=1,p=1$c29tZXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"bad version":   "$argon2id$v=18$m=8,t=1,p=1$c29tZXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"bad params":    "$argon2id$v=19$m=x,t=1,p=1$c29tZXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"zero threads":  "$argon2id$v=19$m=8,t=1,p=0$c29tZXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"bad salt b64":  "$argon2id$v=19$m=8,t=1,p=1$!!!$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"missing hash":  "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ",
		"absurd memory": "$argon2id$v=19$m=4294967295,t=1,p=1$c29tZXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	} {
		ok, err := auth.VerifyPassword("x", h)
		if ok || err == nil {
			t.Errorf("%s: Verify = %v, %v; want false and an error", name, ok, err)
		}
	}
}
