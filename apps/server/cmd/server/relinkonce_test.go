package main

import (
	"context"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// The startup relink runs on a fresh database, records its completion, and
// then stays out of the way on every later start.
func TestRelinkOnceRunsUntilItCompletes(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	_, ran, err := relinkOnce(ctx, pool)
	if err != nil || !ran {
		t.Fatalf("first start: ran=%v err=%v, want the relink to run", ran, err)
	}
	_, ran, err = relinkOnce(ctx, pool)
	if err != nil || ran {
		t.Fatalf("second start: ran=%v err=%v, want the relink skipped", ran, err)
	}
}
