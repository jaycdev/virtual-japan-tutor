#!/usr/bin/env node
// Generates the app icon set for #43 from the 読 glyph in the bundled font.
//
// Design (plan table): 読 drawn from bundled Noto JP Bold, indigo #2F4B7C on
// warm paper #FAF7F0; dark variant #8FA8D8 on #15161A. The SVGs in
// apps/mobile/assets/brand are the design source of record; the glyph *paths*
// are extracted from apps/mobile/assets/fonts/NotoSansJP700.ttf at generation
// time (no installed fonts, no rasteriser required - the TTF's own contours
// are emitted as SVG paths by the small sfnt reader below).
//
// SVG -> PNG uses resvg WASM (@resvg/resvg-wasm, a root devDependency); the
// script requires it and fails loudly without it. PNGs are committed so
// normal builds never need the toolchain:
//
//   pnpm install
//   node scripts/generate-icon.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const app = path.join(root, "apps/mobile");

// ---------- minimal sfnt reader: cmap -> glyf outline -> SVG path ----------
class TrueType {
  constructor(buf) {
    this.buf = buf;
    this.tables = new Map();
    const numTables = buf.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = buf.toString("latin1", o, o + 4);
      const off = buf.readUInt32BE(o + 8);
      const len = buf.readUInt32BE(o + 12);
      this.tables.set(tag, { off, len });
    }
    const h = this.tables.get("head");
    this.unitsPerEm = buf.readInt16BE(h.off + 18);
    const x = this.tables.get("hhea");
    this.ascent = buf.readInt16BE(x.off + 4);
    this.descent = buf.readInt16BE(x.off + 6);
  }
  u16(o) {
    return this.buf.readUInt16BE(o);
  }
  i16(o) {
    return this.buf.readInt16BE(o);
  }
  /** glyph ids for a code point via the best available cmap subtable */
  glyphId(cp) {
    const c = this.tables.get("cmap");
    let best = null;
    const n = this.u16(c.off + 2);
    for (let i = 0; i < n; i++) {
      const r = c.off + 4 + i * 8;
      const platform = this.u16(r);
      const encoding = this.u16(r + 2);
      const off = c.off + this.readU32(r + 4);
      const f = this.u16(off);
      const score =
        (platform === 3 && (encoding === 1 || encoding === 10) ? 2 : platform === 0 ? 2 : 0) +
        (f === 12 ? 1 : 0);
      if (best === null || score > best.score) best = { off, f, score };
    }
    return this.lookupCmap(best.off, cp);
  }
  readU32(at) {
    return this.buf.readUInt32BE(at);
  }
  lookupCmap(sub, cp) {
    const f = this.u16(sub);
    if (f === 4) {
      const segX2 = this.u16(sub + 6);
      // layout after header(14): endCode[segCount], reservedPad(2), startCode[],
      // idDelta[], idRangeOffset[] - the pad must be skipped or every array
      // shifts by 2 bytes and the mapping comes out off-by-one.
      for (let s = 0; s < segX2 / 2; s++) {
        const end = this.u16(sub + 14 + s * 2);
        if (cp <= end) {
          const start = this.u16(sub + segX2 + 16 + s * 2);
          if (cp < start) return 0;
          const delta = this.i16(sub + 2 * segX2 + 16 + s * 2);
          const rangeOff = this.u16(sub + 3 * segX2 + 16 + s * 2);
          if (rangeOff === 0) return (cp + delta) & 0xffff;
          return this.u16(sub + 3 * segX2 + 16 + s * 2 + rangeOff + (cp - start) * 2);
        }
      }
    } else if (f === 12) {
      const ngroups = this.readU32(sub + 12);
      for (let g = 0; g < ngroups; g++) {
        const r = sub + 16 + g * 12;
        const s0 = this.readU32(r),
          e0 = this.readU32(r + 4);
        if (cp >= s0 && cp <= e0) return this.readU32(r + 8) + (cp - s0);
      }
    } else if (f === 6) {
      const first = this.u16(sub + 6),
        cnt = this.u16(sub + 8);
      if (cp >= first && cp < first + cnt) return this.u16(sub + 10 + (cp - first) * 2);
    }
    return 0;
  }
  glyfEntry(gid) {
    const loca = this.tables.get("loca");
    const head = this.tables.get("head");
    const longLoca = this.i16(head.off + 50) === 1;
    const off = loca.off + gid * (longLoca ? 4 : 2);
    const a = longLoca ? this.readU32(off) : this.u16(off) * 2;
    const b = longLoca ? this.readU32(off + 4) : this.u16(off + 2) * 2;
    return { off: this.tables.get("glyf").off + a, end: this.tables.get("glyf").off + b };
  }
  i32(o) {
    return this.buf.readInt32BE(o);
  }
  /**
   * Outline of gid in font units as SVG path segments (M/L/Q/Z).
   * unitBox = max plausible |coordinate| in font units (upem * 4) used as a
   * parse-desync guard: a glyph that exceeds it means we misread the table.
   */
  outline(gid, depth = 0, unitBox = this.unitsPerEm * 4) {
    const g = this.glyfEntry(gid);
    if (g.end <= g.off) return []; // empty (space-like) glyph
    const nContours = this.i16(g.off);
    if (Math.abs(nContours) > 512) throw new Error(`glyf g${gid}: implausible contour count ${nContours} - table parse desynced`);
    if (nContours > 0) {
      const endPts = [];
      let p = g.off + 10;
      for (let i = 0; i < nContours; i++) {
        endPts.push(this.u16(p));
        p += 2;
      }
      const nPts = endPts[nContours - 1] + 1;
      // simple glyph body: endPts[], instructionLength(uint16), instructions[],
      // flags[], xDeltas[], yDeltas[] - flags begin after the instructions.
      const nInstr = this.u16(p);
      p += 2;
      const flagOff = p + nInstr;
      const flags = [];
      let fb = flagOff;
      for (let i = 0; i < nPts; ) {
        const fl = this.buf[fb++];
        flags.push(fl);
        i++;
        if (fl & 8) {
          // repeat flag: the byte after the flag gives extra points sharing fl
          const rep = this.buf[fb++];
          for (let r = 0; r < rep && i < nPts; r++) {
            flags.push(fl);
            i++;
          }
        }
      }
      const xs = [];
      let x = 0;
      p = fb;
      for (let i = 0; i < nPts; i++) {
        const fl = flags[i];
        if (fl & 2) {
          const d = this.buf[p++];
          x += fl & 16 ? d : -d;
        } else if (!(fl & 16)) {
          const d = this.i16(p);
          p += 2;
          x += d;
        }
        xs.push(x);
      }
      const ys = [];
      let y = 0;
      for (let i = 0; i < nPts; i++) {
        const fl = flags[i];
        if (fl & 4) {
          const d = this.buf[p++];
          y += fl & 32 ? d : -d;
        } else if (!(fl & 32)) {
          const d = this.i16(p);
          p += 2;
          y += d;
        }
        ys.push(y);
      }
      for (const v of xs.concat(ys)) {
        if (Math.abs(v) > unitBox)
          throw new Error(`glyf g${gid}: implausible coord ${v} (upem ${this.unitsPerEm}) - table parse desynced`);
      }
      const segs = [];
      const safeEndPts = endPts.map((e) => Math.min(e, nPts - 1));
      let start = 0;
      for (const end of safeEndPts) {
        if (end >= start) this.contour(segs, xs, ys, flags, start, end);
        start = end + 1;
      }
      return segs;
    }
    if (nContours < 0 && depth < 4) {
      // composite: sum referenced components with their 2x2 transforms
      const comps = [];
      let p = g.off + 10;
      let more = true;
      while (more) {
        const flags = this.u16(p);
        const ref = this.u16(p + 2);
        p += 4;
        let dx = 0,
          dy = 0,
          a = 1,
          b = 0,
          c = 0,
          d = 1;
        if (flags & 1) {
          dx = this.i16(p);
          dy = this.i16(p + 2);
          p += 4;
        } else {
          dx = this.i8(p);
          dy = this.i8(p + 1);
          p += 2;
        }
        if (flags & 8) {
          a = d = this.i16(p) / 16384;
          p += 2;
        } else if (flags & 64) {
          a = this.i16(p) / 16384;
          d = this.i16(p + 2) / 16384;
          p += 4;
        } else if (flags & 128) {
          a = this.i16(p) / 16384;
          b = this.i16(p + 2) / 16384;
          c = this.i16(p + 4) / 16384;
          d = this.i16(p + 6) / 16384;
          p += 8;
        }
        for (const s of this.outline(ref, depth + 1, unitBox)) {
          const tf = (pt) => ({
            x: a * pt.x + c * pt.y + dx,
            y: b * pt.x + d * pt.y + dy,
          });
          comps.push(mapSeg(s, tf));
        }
        more = flags & 32;
      }
      return comps.flat();
    }
    return [];
  }
  i8(o) {
    return this.buf.readInt8(o);
  }
  contour(segs, xs, ys, flags, start, end) {
    const n = end - start + 1;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: xs[start + i], y: ys[start + i], on: (flags[start + i] & 1) !== 0 });
    // rotate (not move) so the path starts on an on-curve point where possible
    if (!pts[0].on) {
      const s = pts.findIndex((p) => p.on);
      if (s > 0) pts.push(...pts.splice(0, s));
    }
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let k = 1; k <= n; k++) {
      const cur = pts[k % n];
      if (cur.on) {
        d += ` L${cur.x} ${cur.y}`;
      } else {
        // off-curve control point; its on-curve successor may also be off-curve
        // (TrueType implicit midpoints), in which case the segment ends at the
        // midpoint between the two.
        const nxt = pts[(k + 1) % n];
        if (nxt.on) {
          d += ` Q${cur.x} ${cur.y} ${nxt.x} ${nxt.y}`;
          k++;
        } else {
          d += ` Q${cur.x} ${cur.y} ${(cur.x + nxt.x) / 2} ${(cur.y + nxt.y) / 2}`;
        }
      }
    }
    d += " Z";
    segs.push(d);
  }
}
function mapSeg(d, tf) {
  return d.replace(/(-?\d+(?:\.\d+)?)(?: |-)(-?\d+(?:\.\d+)?)/g, (_, x, y) => {
    const p = tf({ x: +x, y: +y });
    return `${r(p.x)} ${r(p.y)}`;
  });
}
const r = (n) => Math.round(n * 100) / 100;

// ---------- build one square icon SVG ----------
function iconSvg(ttf, char, { size, fg, bg, glyphFrac, dark }) {
  const gid = ttf.glyphId(char.codePointAt(0));
  const contours = ttf.outline(gid);
  // centre on the glyph's own bounding box (not the em box) and scale it to
  // glyphFrac of the icon box, so the artwork sits optically centred
  const nums = contours.flatMap((d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number));
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  const box = size;
  const s = (box * glyphFrac) / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const px = (x) => r(box / 2 + (x - cx) * s);
  const py = (y) => r(box / 2 - (y - cy) * s);
  const paths = contours
    .map((d) => {
      const dd = d
        .replace(/([MLQZ])(-?\d+)/g, (_, c, v) => c + v) // normalise (numbers are ints here)
        .replace(/(-?\d+(?:\.\d+)?)(?: |-)(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${px(+x)} ${py(+y)}`);
      return `  <path d="${dd}"/>`;
    })
    .join("\n");
  const comment = dark ? "dark" : "light";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- vjt app icon (${comment}): ${char} from NotoSansJP700.ttf (OFL), generated by scripts/generate-icon.mjs -->
<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
  <rect width="${box}" height="${box}"${bg ? ` fill="${bg}"` : ' fill="none"'}/>
  <g fill="${fg}" fill-rule="nonzero">
${paths}
  </g>
</svg>
`;
}

// ---------- outputs ----------
const ttf = new TrueType(readFileSync(path.join(app, "assets/fonts/NotoSansJP700.ttf")));
const brand = path.join(app, "assets/brand");
mkdirSync(brand, { recursive: true });

const CHAR = "読";
const LIGHT = { fg: "#2F4B7C", bg: "#FAF7F0" };
const DARK = { fg: "#8FA8D8", bg: "#15161A" };

// design source of record (plan spec): full-bleed light + dark; icon-fg is the
// transparent glyph layer for Android's adaptive icon, icon-monochrome feeds
// Android's themed-icon tinting, icon-bg is the flat background layer.
writeFileSync(path.join(brand, "icon.svg"), iconSvg(ttf, CHAR, { size: 512, glyphFrac: 0.62, ...LIGHT, dark: false }));
writeFileSync(path.join(brand, "icon-dark.svg"), iconSvg(ttf, CHAR, { size: 512, glyphFrac: 0.62, ...DARK, dark: true }));
writeFileSync(path.join(brand, "icon-fg.svg"), iconSvg(ttf, CHAR, { size: 512, glyphFrac: 0.5, fg: LIGHT.fg, bg: null, dark: false }));
writeFileSync(path.join(brand, "icon-monochrome.svg"), iconSvg(ttf, CHAR, { size: 512, glyphFrac: 0.5, fg: "#000000", bg: null, dark: false }));
writeFileSync(
  path.join(brand, "icon-bg.svg"),
  '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FAF7F0"/></svg>\n'
);

console.log("SVG sources written to apps/mobile/assets/brand/.");

// ---------- rasterise (requires @resvg/resvg-wasm: root devDependency) ----------
{
  const { Resvg, initWasm } = await import("@resvg/resvg-wasm");
  await initWasm(readFileSync(path.join(root, "node_modules/@resvg/resvg-wasm/index_bg.wasm")));
  const render = (svgPath, size) =>
    new Resvg(readFileSync(svgPath, "utf8"), { fitTo: { mode: "width", value: size } }).render().asPng();

  // store icon: light art (iOS/legacy Android); launchers mask the adaptive layers
  writeFileSync(path.join(app, "assets/icon.png"), render(path.join(brand, "icon.svg"), 1024));
  writeFileSync(path.join(app, "assets/favicon.png"), render(path.join(brand, "icon.svg"), 64));
  writeFileSync(path.join(app, "assets/android-icon-foreground.png"), render(path.join(brand, "icon-fg.svg"), 432));
  writeFileSync(path.join(app, "assets/android-icon-background.png"), render(path.join(brand, "icon-bg.svg"), 432));
  writeFileSync(path.join(app, "assets/android-icon-monochrome.png"), render(path.join(brand, "icon-monochrome.svg"), 432));
  console.log("PNGs regenerated: icon, favicon, android-icon-{foreground,background,monochrome}.");
}
