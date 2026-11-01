-- Global reference data imported from open datasets (ADR-0002, 0005, 0006).
-- Nothing here belongs to a user: there is no user_id on any of these tables.
-- Every table is filled by `import` (apps/server/cmd/import) and can be reloaded
-- at any time; see internal/refdata for how each one is populated.

-- +goose Up

-- One row per dataset version imported. Re-importing the same source (same
-- checksum) updates the row instead of adding one, so history only grows when
-- the upstream data actually changes.
CREATE TABLE import_runs (
    id          bigserial PRIMARY KEY,
    dataset     text        NOT NULL CHECK (dataset IN ('jmdict', 'kanjidic2', 'waller', 'kanjium', 'grammar')),
    version     text        NOT NULL DEFAULT '',  -- the dataset's own version or creation date
    source_url  text        NOT NULL,
    licence     text        NOT NULL,
    licence_url text        NOT NULL,
    checksum    text        NOT NULL,             -- sha256 of the source file(s)
    fetched_at  timestamptz NOT NULL,             -- when the source files were downloaded (or last modified, for local files)
    imported_at timestamptz NOT NULL DEFAULT now(),
    row_counts  jsonb       NOT NULL DEFAULT '{}',
    UNIQUE (dataset, checksum)
);

-- JMdict (EDRDG, CC BY-SA 4.0): vocabulary. ent_seq is JMdict's stable entry id.
CREATE TABLE jmdict_tags (
    code        text PRIMARY KEY,   -- e.g. 'uk', 'v1', 'n'
    description text NOT NULL       -- e.g. 'word usually written using kana alone'
);

CREATE TABLE jmdict_entries (
    ent_seq   bigint  PRIMARY KEY,
    is_common boolean NOT NULL      -- any form tagged ichi1, news1, spec1, spec2 or gai1
);

CREATE TABLE jmdict_kanji_forms (
    ent_seq  bigint   NOT NULL REFERENCES jmdict_entries (ent_seq) ON DELETE CASCADE,
    ord      smallint NOT NULL,
    text     text     NOT NULL,
    info     text[]   NOT NULL DEFAULT '{}',
    priority text[]   NOT NULL DEFAULT '{}',
    PRIMARY KEY (ent_seq, ord)
);
CREATE INDEX jmdict_kanji_forms_text_idx ON jmdict_kanji_forms (text);

CREATE TABLE jmdict_readings (
    ent_seq     bigint   NOT NULL REFERENCES jmdict_entries (ent_seq) ON DELETE CASCADE,
    ord         smallint NOT NULL,
    text        text     NOT NULL,
    no_kanji    boolean  NOT NULL DEFAULT false,  -- not a reading of any kanji form
    restrict_to text[]   NOT NULL DEFAULT '{}',   -- when non-empty, only these kanji forms
    info        text[]   NOT NULL DEFAULT '{}',
    priority    text[]   NOT NULL DEFAULT '{}',
    PRIMARY KEY (ent_seq, ord)
);
CREATE INDEX jmdict_readings_text_idx ON jmdict_readings (text);

CREATE TABLE jmdict_senses (
    ent_seq bigint   NOT NULL REFERENCES jmdict_entries (ent_seq) ON DELETE CASCADE,
    ord     smallint NOT NULL,
    pos     text[]   NOT NULL DEFAULT '{}',  -- parts of speech (codes in jmdict_tags)
    field   text[]   NOT NULL DEFAULT '{}',
    misc    text[]   NOT NULL DEFAULT '{}',
    dialect text[]   NOT NULL DEFAULT '{}',
    info    text[]   NOT NULL DEFAULT '{}',
    stagk   text[]   NOT NULL DEFAULT '{}',  -- applies only to these kanji forms
    stagr   text[]   NOT NULL DEFAULT '{}',  -- applies only to these readings
    xref    text[]   NOT NULL DEFAULT '{}',
    antonym text[]   NOT NULL DEFAULT '{}',
    glosses text[]   NOT NULL DEFAULT '{}',  -- English
    PRIMARY KEY (ent_seq, ord)
);

-- KANJIDIC2 (EDRDG, CC BY-SA 4.0): kanji.
CREATE TABLE kanji (
    literal      text     PRIMARY KEY,
    grade        smallint,                   -- 1-6 kyouiku, 8 other jouyou, 9-10 jinmeiyou
    stroke_count smallint,
    frequency    integer,                    -- newspaper frequency rank, 1 = most frequent
    -- KANJIDIC2's own <jlpt> value, on the pre-2010 four-level scale (4 = easiest).
    -- It does NOT correspond to N5-N1 and is kept for reference only. The app's
    -- JLPT Level for a kanji comes from jlpt_kanji.
    legacy_jlpt  smallint,
    nanori       text[]   NOT NULL DEFAULT '{}'
);

CREATE TABLE kanji_readings (
    literal text     NOT NULL REFERENCES kanji (literal) ON DELETE CASCADE,
    kind    text     NOT NULL CHECK (kind IN ('on', 'kun')),
    ord     smallint NOT NULL,
    reading text     NOT NULL,
    PRIMARY KEY (literal, kind, ord)
);

CREATE TABLE kanji_meanings (
    literal text     NOT NULL REFERENCES kanji (literal) ON DELETE CASCADE,
    ord     smallint NOT NULL,
    meaning text     NOT NULL,                -- English
    PRIMARY KEY (literal, ord)
);

-- Jonathan Waller's JLPT lists (CC BY): JLPT Level for vocabulary and kanji.
-- Words on no list have no JLPT Level (no row here).
--
-- jlpt_vocab_entries keeps every list row as published, matched or not, so
-- unmatched words can be reported rather than silently dropped. A row that
-- matched has one or more rows in jlpt_vocab_links.
CREATE TABLE jlpt_vocab_entries (
    jlpt_level   text NOT NULL CHECK (jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')),
    written      text NOT NULL DEFAULT '',   -- empty for words listed in kana only
    reading      text NOT NULL DEFAULT '',
    meaning      text NOT NULL DEFAULT '',
    match_method text NOT NULL DEFAULT '',   -- exact, written, kana, kana_ambiguous; empty = unmatched
    PRIMARY KEY (jlpt_level, written, reading)
);

CREATE TABLE jlpt_vocab_links (
    jlpt_level text   NOT NULL,
    written    text   NOT NULL,
    reading    text   NOT NULL,
    ent_seq    bigint NOT NULL REFERENCES jmdict_entries (ent_seq) ON DELETE CASCADE,
    PRIMARY KEY (jlpt_level, written, reading, ent_seq),
    FOREIGN KEY (jlpt_level, written, reading)
        REFERENCES jlpt_vocab_entries (jlpt_level, written, reading) ON DELETE CASCADE
);
CREATE INDEX jlpt_vocab_links_ent_seq_idx ON jlpt_vocab_links (ent_seq);

-- No foreign key to kanji: a list may name characters KANJIDIC2 lacks, and those are reported.
CREATE TABLE jlpt_kanji (
    literal    text NOT NULL,
    jlpt_level text NOT NULL CHECK (jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')),
    PRIMARY KEY (literal, jlpt_level)
);

-- A word or kanji can be on the list for more than one level; it counts at the
-- easiest. 'N5' sorts after 'N1' as text, so max() picks the easiest level.
CREATE VIEW jmdict_jlpt_level AS
SELECT l.ent_seq, max(l.jlpt_level) AS jlpt_level
FROM jlpt_vocab_links l
GROUP BY l.ent_seq;

CREATE VIEW kanji_jlpt_level AS
SELECT literal, max(jlpt_level) AS jlpt_level
FROM jlpt_kanji
GROUP BY literal;

-- Kanjium (CC BY-SA 4.0): pitch accent. All patterns per (word, reading) are kept;
-- rank 1 is the one Kanjium lists first, which we treat as the most common.
CREATE TABLE pitch_accents (
    word       text     NOT NULL,
    reading    text     NOT NULL,
    rank       smallint NOT NULL,
    -- Mora after which the pitch drops; 0 = flat (heiban).
    pattern    smallint NOT NULL CHECK (pattern >= 0),
    tag        text     NOT NULL DEFAULT '',  -- Kanjium's part-of-speech note, e.g. '副'
    is_primary boolean  NOT NULL,
    PRIMARY KEY (word, reading, rank)
);
CREATE UNIQUE INDEX pitch_accents_one_primary_idx ON pitch_accents (word, reading) WHERE is_primary;

-- Grammar Catalogue (data/grammar/jlpt-grammar.csv, ADR-0005). A Grammar Point is a
-- pattern at a JLPT Level; the same pattern at two levels is two points, and so is
-- a pattern listed twice at one level (ordinal 1, 2), as the spreadsheet does for
-- のに and そうだ at N4. The id is stable across re-imports.
CREATE TABLE grammar_points (
    id                  bigserial PRIMARY KEY,
    jlpt_level          text     NOT NULL CHECK (jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')),
    catalogue_number    integer  NOT NULL,
    ordinal             smallint NOT NULL DEFAULT 1,
    pattern             text     NOT NULL,   -- as written in the spreadsheet
    romaji              text     NOT NULL,
    meaning             text     NOT NULL,
    variants            text[]   NOT NULL,   -- pattern split on the middle dot and slash
    normalised_pattern  text     NOT NULL,   -- see refdata.NormalisePattern
    normalised_variants text[]   NOT NULL,
    explanation         text,                -- filled in later (AI-generated), not by the import
    UNIQUE (jlpt_level, normalised_pattern, ordinal),
    UNIQUE (jlpt_level, catalogue_number) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX grammar_points_normalised_pattern_idx ON grammar_points (normalised_pattern);
CREATE INDEX grammar_points_normalised_variants_idx ON grammar_points USING gin (normalised_variants);

-- +goose Down
DROP TABLE grammar_points;
DROP TABLE pitch_accents;
DROP VIEW kanji_jlpt_level;
DROP VIEW jmdict_jlpt_level;
DROP TABLE jlpt_kanji;
DROP TABLE jlpt_vocab_links;
DROP TABLE jlpt_vocab_entries;
DROP TABLE kanji_meanings;
DROP TABLE kanji_readings;
DROP TABLE kanji;
DROP TABLE jmdict_senses;
DROP TABLE jmdict_readings;
DROP TABLE jmdict_kanji_forms;
DROP TABLE jmdict_entries;
DROP TABLE jmdict_tags;
DROP TABLE import_runs;
