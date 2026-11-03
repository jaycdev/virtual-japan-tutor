# Noto JP fonts (issue #42 spike)

Static Noto JP family files used by the spike's `expo-font` loads:

| File | Font | Weight | Size |
|------|------|--------|------|
| `NotoSansJP-400.ttf` / `NotoSansJP-700.ttf` | Noto Sans JP | 400 / 700 | ~4.9 MB each |
| `NotoSerifJP-400.ttf` / `NotoSerifJP-700.ttf` | Noto Serif JP | 400 / 700 | ~6.9 MB each |
| `web/*.woff2` | same families | 400 / 700 | ~2.0-2.7 MB each |

These are the FULL static family files (~14,500 glyphs each) from the
google/fonts repo, not subsets - the spike wanted byte-for-byte worst-case
payload numbers. #43 should cut them with `pyftsubset` (kana + punctuation +
JLPT-range kanji) or switch to on-demand/variable fonts; see
`apps/app/TRIAL_RESULTS.md` (payload risk).

Both families are licensed under the SIL Open Font License 1.1; the licence
text travels with them as required:

- `OFL-notosansjp.txt` (from google/fonts `ofl/notosansjp`)
- `OFL-notoserifjp.txt` (from google/fonts `ofl/notoserifjp`)

Source: https://fonts.google.com/noto - the OFL permits redistribution
(including modified/subset builds) as long as the licence stays with the
font files.
