package main

import (
	"strings"
	"testing"
)

func TestReadPasswordLineTakesTheFirstLineWithoutTheNewline(t *testing.T) {
	for in, want := range map[string]string{
		"s3cret-pass\n":          "s3cret-pass",
		"s3cret-pass\r\n":        "s3cret-pass",
		"s3cret-pass":            "s3cret-pass", // no trailing newline (e.g. printf)
		"with spaces inside \n":  "with spaces inside ",
		"first\nsecond\n":        "first",
	} {
		got, err := readPasswordLine(strings.NewReader(in))
		if err != nil || got != want {
			t.Errorf("readPasswordLine(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}

func TestReadPasswordLineRejectsEmptyInput(t *testing.T) {
	for _, in := range []string{"", "\n", "\r\n"} {
		if _, err := readPasswordLine(strings.NewReader(in)); err == nil {
			t.Errorf("readPasswordLine(%q) succeeded, want an error", in)
		}
	}
}

func TestParseCreateUserArgsRequiresAUsernameAndRefusesPasswordFlags(t *testing.T) {
	if name, err := parseCreateUserArgs([]string{"--username", "owner"}); err != nil || name != "owner" {
		t.Fatalf("got %q, %v", name, err)
	}
	if _, err := parseCreateUserArgs(nil); err == nil {
		t.Fatal("missing --username should fail")
	}
	// The password must never travel through argv (visible in process listings and history).
	if _, err := parseCreateUserArgs([]string{"--username", "owner", "--password", "hunter2hunter2"}); err == nil {
		t.Fatal("a --password flag must be rejected")
	}
}
