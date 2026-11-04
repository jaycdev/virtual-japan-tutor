import type { DictionaryEntry } from "@vjt/api-client";

/** How many glosses a dictionary entry has, across every sense. */
export function countGlosses(entry: DictionaryEntry): number {
  return entry.senses.reduce((n, s) => n + s.glosses.length, 0);
}

/** The first `n` glosses in dictionary order: what the Lookup row shows. */
export function firstGlosses(entry: DictionaryEntry, n: number): string[] {
  const out: string[] = [];
  for (const sense of entry.senses) {
    for (const g of sense.glosses) {
      out.push(g);
      if (out.length >= n) return out;
    }
  }
  return out;
}
