// Generates the unicode-range-sliced webfont subsets (ADR-0009): two woff2
// slices per bundled Noto JP face, served from our own web build. global.css
// references them as /fonts/<face>-<slice>.woff2; a page only downloads the
// slices whose ranges it actually renders (login/showcase: latin-kana only).
//
//   node scripts/subset-fonts.mjs     (needs `uv`/`uvx` on PATH for fontTools)
//
// The fontTools version is pinned (see the exec below) so slice bytes are
// reproducible across machines/CI. Bump the pin deliberately and re-check the
// committed slice sizes when it moves.
// The Android TTFs in apps/app/assets/fonts/ stay full (expo-font bundles them;
// Android has no unicode-range loading). Commit the generated files: they are
// static assets of the web export, rebuilt rarely and reviewed by diff size.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "apps/app/assets/fonts";
const OUT_DIR = "apps/app/public/fonts";

// Hyphen-free face ids: uniwind's native CSS pipeline mis-parses hyphenated
// font-family values (crashes the Text component), and expo-font registers
// Android fonts by file basename, so the TTFs, slices and CSS family names
// all use these exact ids.
const FACES = ["NotoSansJP400", "NotoSansJP700", "NotoSerifJP400", "NotoSerifJP700"];

// Must stay in sync with the @font-face unicode-range blocks in apps/app/global.css.
// One kanji slice per face: CJK glyphs share component glyphs across the whole
// block, so splitting them further duplicates components and inflates the sum.
const SLICES = {
  "latin-kana": "U+0020-007E,U+00A0-00FF,U+2000-206F,U+3000-303F,U+3040-30FF,U+FF00-FFEF",
  kanji: "U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF",
};

mkdirSync(OUT_DIR, { recursive: true });

const rows = [];
for (const face of FACES) {
  for (const [slice, unicodes] of Object.entries(SLICES)) {
    const out = join(OUT_DIR, `${face}-${slice}.woff2`);
    execFileSync(
      "uvx",
      [
        "--from",
        "fonttools[woff]==4.68.0",
        "pyftsubset",
        join(SRC_DIR, `${face}.ttf`),
        `--unicodes=${unicodes}`,
        "--flavor=woff2",
        "--layout-features=kern,liga,ccmp,locl",
        "--no-glyph-names",
        `--output-file=${out}`,
      ],
      { stdio: "inherit" },
    );
    rows.push({ file: `${face}-${slice}.woff2`, bytes: statSync(out).size });
  }
}

const total = rows.reduce((sum, r) => sum + r.bytes, 0);
for (const r of rows) console.log(`${r.file.padEnd(34)} ${r.bytes.toLocaleString("en-US")} bytes`);
console.log(`\nTOTAL ${rows.length} files, ${total.toLocaleString("en-US")} bytes`);
