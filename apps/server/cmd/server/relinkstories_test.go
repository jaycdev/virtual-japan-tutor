package main

import "testing"

func TestParseRelinkStoriesArgsTakesNoArguments(t *testing.T) {
	for _, tc := range []struct {
		name    string
		args    []string
		wantErr bool
	}{
		{"no arguments", nil, false},
		{"empty slice", []string{}, false},
		{"a stray word", []string{"now"}, true},
		{"a flag", []string{"--dry-run"}, true},
	} {
		err := parseRelinkStoriesArgs(tc.args)
		if (err != nil) != tc.wantErr {
			t.Errorf("%s: parseRelinkStoriesArgs(%q) error = %v, want error %v", tc.name, tc.args, err, tc.wantErr)
		}
	}
}
