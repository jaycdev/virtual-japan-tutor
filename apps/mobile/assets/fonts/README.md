# Noto JP fonts

Static Noto JP family files bundled with the app. Face ids are hyphen-free (`NotoSansJP400`, not `NotoSansJP-400`) on
purpose: expo-font registers Android fonts by file basename, and uniwind's
native CSS pipeline mis-parses hyphenated `font-family` values. The TTFs,
the woff2 slices, the `@font-face` blocks and the `--font-*` tokens in
`global.css` all use these exact ids.

| File | Font | Weight | Size |
|------|------|--------|------|
| `NotoSansJP400.ttf` / `NotoSansJP700.ttf` | Noto Sans JP | 400 / 700 | ~4.9 MB each |
| `NotoSerifJP400.ttf` / `NotoSerifJP700.ttf` | Noto Serif JP | 400 / 700 | ~6.9 MB each |

These are the FULL static family files (~14,500 glyphs each) from the
google/fonts repo. Android bundles them via `expo-font`
(`src/fonts.ts`); Android has no `unicode-range` loading, so they
stay full for now (device-side subsetting is tracked after #43).

The web app never ships these TTFs. `scripts/subset-fonts.mjs` slices each
face into two `unicode-range`-tagged woff2 files (latin-kana + kanji) for the
web app (`apps/web/public/fonts/`, #76), per ADR-0009. Regenerate with:

    node scripts/subset-fonts.mjs   # needs `uv`/`uvx` on PATH for fontTools

Both families are licensed under the SIL Open Font License 1.1; the licence
text travels with them as required:

- `OFL-notosansjp.txt` (from google/fonts `ofl/notosansjp`)
- `OFL-notoserifjp.txt` (from google/fonts `ofl/notoserifjp`)

Source: https://fonts.google.com/noto - the OFL permits redistribution
(including modified/subset builds) as long as the licence stays with the
font files.
