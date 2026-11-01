-- +goose Up
-- MaruMori connection and Sync (GLOSSARY.md, docs/adr/0002): the Learner's knowledge
-- state as read from MaruMori. Only identity and SRS progress are stored — never
-- MaruMori item content (meanings, readings, mnemonics, examples, personal notes).

-- The stored MaruMori API key. A row exists exactly while the Learner is connected;
-- deleting the key deletes the row (synced knowledge stays, like an AI Provider delete).
CREATE TABLE marumori_settings (
    user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- internal/secrets ciphertext ("v1:..."). Never selected into a response or a log.
    api_key_encrypted text NOT NULL,
    connected_at      timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One Known Item (SRS level 1+) per MaruMori item. A MaruMori id is only unique within
-- its type ("Kanji/3964299", "VocabularyForms/31288892"), so the key is (user, kind, id).
-- A linked item stores only the link; `text` exists only for unlinked items, so no
-- MaruMori wording is kept when reference data already covers the item.
CREATE TABLE marumori_known_items (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('kanji', 'vocabulary')),
    marumori_id     text NOT NULL,
    srs_level       int NOT NULL CHECK (srs_level >= 1),
    text            text,
    kanji_literal   text REFERENCES kanji(literal),
    jmdict_ent_seq  bigint REFERENCES jmdict_entries(ent_seq),
    first_synced_at timestamptz NOT NULL,
    last_seen_at    timestamptz NOT NULL,
    -- Disappeared items are marked, never deleted: the row keeps its history role.
    disappeared_at  timestamptz,
    PRIMARY KEY (user_id, kind, marumori_id),
    CHECK (NOT (kanji_literal IS NOT NULL AND jmdict_ent_seq IS NOT NULL)),
    CHECK (kanji_literal IS NULL OR kind = 'kanji'),
    CHECK (jmdict_ent_seq IS NULL OR kind = 'vocabulary'),
    CHECK (text IS NULL OR (kanji_literal IS NULL AND jmdict_ent_seq IS NULL))
);

CREATE INDEX marumori_known_items_user_kind_idx ON marumori_known_items (user_id, kind);

-- One Sync run. At most one `running` run per user (the Sync single-flight).
CREATE TABLE marumori_sync_runs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
    started_at  timestamptz NOT NULL,
    finished_at timestamptz,
    -- Learner-facing failure text; never contains the API key.
    error       text,
    -- internal/marumorisync.Counts, serialised.
    counts      jsonb,
    -- Target of the composite FK below: history can only point at the same user's run.
    UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX marumori_sync_runs_one_running_idx
    ON marumori_sync_runs (user_id) WHERE status = 'running';

CREATE INDEX marumori_sync_runs_user_started_idx ON marumori_sync_runs (user_id, started_at DESC);

-- What each Sync changed in the Known Item set (see Sync history in the GLOSSARY).
CREATE TABLE marumori_known_item_history (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL,
    sync_run_id uuid NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('kanji', 'vocabulary')),
    marumori_id text NOT NULL,
    -- An item dropping to SRS level 0 is no longer Known: recorded as `disappeared`.
    change      text NOT NULL CHECK (change IN ('appeared', 'level_changed', 'disappeared')),
    old_level   int,
    new_level   int,
    FOREIGN KEY (user_id, sync_run_id) REFERENCES marumori_sync_runs (user_id, id) ON DELETE CASCADE
);

CREATE INDEX marumori_known_item_history_user_idx ON marumori_known_item_history (user_id, id);

-- Per-Grammar-point SRS progress from /srs/grammar-lessons and /srs/grammar-reviews.
-- Only the MaruMori id and progress: grammar point names and explanations are content
-- (ADR-0002) and are not stored.
CREATE TABLE marumori_grammar_observations (
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marumori_id   text NOT NULL,
    -- NULL for a lesson-only point (not in a review yet, so no progress object was sent).
    srs_level     int,
    suspended     boolean,
    first_seen_at timestamptz NOT NULL,
    last_seen_at  timestamptz NOT NULL,
    PRIMARY KEY (user_id, marumori_id)
);

-- The scalar counters from /home (counts.* and stats.*). The of-the-day objects are
-- never decoded, so nothing from them can reach here.
CREATE TABLE marumori_home_stats (
    user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    synced_at               timestamptz NOT NULL,
    total_learned           int NOT NULL,
    kanji_learned           int NOT NULL,
    vocabulary_learned      int NOT NULL,
    grammar_lessons_done    int NOT NULL,
    pending_lessons         int NOT NULL,
    pending_reviews         int NOT NULL,
    grammar_total           int NOT NULL,
    pending_grammar_lessons int NOT NULL,
    pending_grammar_reviews int NOT NULL,
    accuracy                numeric NOT NULL,
    grammar_accuracy        numeric NOT NULL
);

-- +goose Down
DROP TABLE marumori_home_stats;
DROP TABLE marumori_known_item_history;
DROP TABLE marumori_sync_runs;
DROP TABLE marumori_grammar_observations;
DROP TABLE marumori_known_items;
DROP TABLE marumori_settings;
