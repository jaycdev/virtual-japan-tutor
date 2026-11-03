package story

import (
	"context"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// A spelling can belong to several dictionary entries (いる: "to be" and 射る,
// "to shoot"). The lookup must hand all of them to the gate, which counts the
// spelling as known when the Learner knows any.
func TestRefdataLookupReturnsEveryEntryOfASpelling(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	for _, q := range []string{
		`INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (7710001, true), (7710002, false), (7710003, true)`,
		`INSERT INTO jmdict_kanji_forms (ent_seq, ord, text) VALUES (7710001, 1, '居る'), (7710002, 1, '射る'), (7710003, 1, '要る')`,
		`INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES (7710001, 1, 'いる'), (7710002, 1, 'いる'), (7710003, 1, 'いる')`,
		`INSERT INTO jmdict_senses (ent_seq, ord, glosses) VALUES (7710001, 1, ARRAY['to be']), (7710002, 1, ARRAY['to shoot']), (7710003, 1, ARRAY['to need'])`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed: %v\n%s", err, q)
		}
	}

	hit, ok, err := NewRefdataLookup(pool).Lookup(ctx, "いる", "いる")
	if err != nil || !ok {
		t.Fatalf("Lookup: ok=%v err=%v", ok, err)
	}
	if hit.EntSeq != 7710001 && hit.EntSeq != 7710003 {
		t.Fatalf("primary entry = %d, want a common one first", hit.EntSeq)
	}
	got := map[int64]string{}
	for _, a := range hit.Alts {
		got[a.EntSeq] = a.JA
	}
	if len(got) != 3 || got[7710001] != "居る" || got[7710002] != "射る" || got[7710003] != "要る" {
		t.Fatalf("Alts = %+v, want all three entries of いる with their headwords", hit.Alts)
	}
	if hit.Alts[0].EntSeq != hit.EntSeq {
		t.Fatalf("Alts must start with the primary entry, got %+v", hit.Alts)
	}
}
