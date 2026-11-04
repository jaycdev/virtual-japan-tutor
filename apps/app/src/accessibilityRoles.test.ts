import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The accessibility-role guard (#50 review, S7).
 *
 * RN 0.88 typed props cannot catch a bad role: ViewAccessibility's
 * AccessibilityRole union ends in `| string`, so `accessibilityRole="status"`
 * passes tsc and then HARD-CRASHES the Android host (RCTText has no such
 * role — this exact crash cost a device evidence run). The test scans the
 * shipped sources for role literals and fails on any value outside the set
 * verified safe on both hosts. Widening a set is an explicit act: try the
 * candidate on an Android device first, then add it here.
 *
 * The lists: every value below is in ViewAccessibility.AccessibilityRole
 * (node_modules/react-native/types_generated/.../ViewAccessibility.d.ts)
 * or Role, and renders correctly through react-native-web as well.
 * role="status" is only on the ROLE list — the safe spelling for a live
 * region is role="status" + accessibilityLiveRegion="polite"; the
 * accessibilityRole spelling is the one that crashes.
 */
const ACCESSIBILITY_ROLE_SAFE = new Set([
  'alert',
  'button',
  'header',
  'link',
  'progressbar',
  'tab',
  'text',
]);

const ROLE_SAFE = new Set([
  'alert',
  'button',
  'heading',
  'link',
  'menuitem',
  'progressbar',
  'status',
  'tab',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Strip comments before scanning: prose about the crash (Practice.tsx
 * explains the bad spelling inline) would otherwise trip the very guard
 * written to keep that spelling out of code. The line-comment pattern
 * keeps `://` in URLs intact.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
}

function findRoles(file: string): { prop: string; value: string; line: number }[] {
  const stripped = stripComments(readFileSync(file, 'utf8'));
  const found: { prop: string; value: string; line: number }[] = [];
  for (const [prop, pattern, safe] of [
    ['accessibilityRole', /accessibilityRole="([a-z-]+)"/g, ACCESSIBILITY_ROLE_SAFE],
    ['role', /(?<!\w)role="([a-z-]+)"/g, ROLE_SAFE],
  ] as const) {
    for (const match of stripped.matchAll(pattern)) {
      if (!safe.has(match[1])) {
        found.push({ prop, value: match[1], line: stripped.slice(0, match.index).split('\n').length });
      }
    }
  }
  return found;
}

describe('accessibility role literals', () => {
  // vitest's cwd is the project root (apps/app), and import.meta.url here is
  // a transformed module id, not a file: URL.
  const roots = [join(process.cwd(), 'src'), join(process.cwd(), 'app')];
  const files = roots.flatMap(sourceFiles);

  it('scans real files (a broken scan would vacuously pass)', () => {
    expect(files.length).toBeGreaterThan(40);
    // The scan must actually see good roles, or the regex broke.
    const seen = files.flatMap((f) => stripComments(readFileSync(f, 'utf8')).match(/accessibilityRole="[a-z-]+"/g) ?? []);
    expect(seen.length).toBeGreaterThan(10);
  });

  it('uses only device-verified accessibilityRole and role values', () => {
    const offenders = files.flatMap(findRoles);
    expect(
      offenders.map((o) => `${o.file}: uses ${o.prop}="${o.value}"`),
    ).toEqual([]);
  });
});
