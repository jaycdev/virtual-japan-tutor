// The Part of Speech of a dictionary sense (issue #132). The server sends
// JMdict's entity codes ("n", "v5r", "vt", "adj-na", ...); this module turns a
// sense's codes into what the Learner reads: a broad type, a verb's group and
// transitivity, and the few flags worth a line. Pure. The labels come through
// a `speak` function (useT().t in the apps), so they follow the Interface
// Language and its furigana.

import type { RubyText } from "../i18n/ruby.ts";
import type { StringKey } from "../i18n/strings.ts";

/** The broad types a Learner sees, in display order (a sense shows them in this order). */
export const BROAD_PARTS_OF_SPEECH = [
  "noun",
  "pronoun",
  "verb",
  "i-adjective",
  "na-adjective",
  "adverb",
  "particle",
  "conjunction",
  "interjection",
  "auxiliary",
  "counter",
  "prefix",
  "suffix",
  "expression",
  "numeric",
] as const;
export type BroadPartOfSpeech = (typeof BROAD_PARTS_OF_SPEECH)[number];

/**
 * A verb's group, without its ending detail. Godan covers every v5* code (v5r-i
 * and v5k-s conjugate as godan); ichidan covers v1, v1-s and vz; irregular covers
 * kuru (vk), the nu verbs (vn) and the suru family (vs-i, vs-s, vs-c). The archaic
 * nidan and yodan codes have no group: they show only the broad type.
 */
export type VerbGroup = "godan" | "ichidan" | "irregular";

export type Transitivity = "transitive" | "intransitive" | "both";

/** Flags a Learner reads as a short extra line; the Lookup row shows only `takesSuru`. */
export type PartOfSpeechFlag = "takesSuru" | "takesNo" | "takesTo" | "adverbial";
const FLAG_ORDER = ["takesSuru", "takesNo", "takesTo", "adverbial"] as const satisfies readonly PartOfSpeechFlag[];

/** A sense's Part of Speech: what its JMdict codes say, nothing more. */
export interface PartOfSpeech {
  /** Broad types, deduplicated, in BROAD_PARTS_OF_SPEECH order. */
  types: BroadPartOfSpeech[];
  /** Set only when the codes agree on one group. */
  verbGroup?: VerbGroup;
  /** Set when the codes say vt and/or vi, on a verb or a suru-noun (n + vs). */
  transitivity?: Transitivity;
  flags: PartOfSpeechFlag[];
}

/** Anything that carries a sense's JMdict codes (a DictionarySense does). */
export interface SenseCodes {
  partsOfSpeech: readonly string[];
}

/** Looks up one string-table entry; useT().t satisfies it. */
export type Speak = (key: StringKey) => RubyText;

interface CodeMeaning {
  type?: BroadPartOfSpeech;
  verbGroup?: VerbGroup;
  direction?: "transitive" | "intransitive";
  flag?: PartOfSpeechFlag;
}

const GODAN_CODES = [
  "v5aru", "v5b", "v5g", "v5k", "v5k-s", "v5m", "v5n", "v5r", "v5r-i", "v5s", "v5t", "v5u", "v5u-s", "v5uru",
];
const ICHIDAN_CODES = ["v1", "v1-s", "vz"];
const IRREGULAR_CODES = ["vk", "vn", "vs-i", "vs-s", "vs-c"];
// Archaic nidan and yodan classes, plus the unspecified verb and vr (irregular ru
// verb, archaic; plural form ends in -ri): verbs with no group.
const VERB_ONLY_CODES = [
  "v-unspec", "vr",
  "v2a-s", "v2b-k", "v2b-s", "v2d-k", "v2d-s", "v2g-k", "v2g-s", "v2h-k", "v2h-s", "v2k-k", "v2k-s",
  "v2m-k", "v2m-s", "v2n-s", "v2r-k", "v2r-s", "v2s-s", "v2t-k", "v2t-s", "v2w-s", "v2y-k", "v2y-s", "v2z-s",
  "v4b", "v4g", "v4h", "v4k", "v4m", "v4n", "v4r", "v4s", "v4t",
];

/**
 * Every JMdict part-of-speech entity, handled on purpose. A code missing here
 * contributes nothing; `unc` (unclassified) is the one deliberate blank.
 */
const CODE_MEANINGS = new Map<string, CodeMeaning>([
  // Nouns. adj-no is a noun that takes の; n-adv is a noun that also works as an adverb.
  ["n", { type: "noun" }],
  ["n-adv", { type: "noun", flag: "adverbial" }],
  ["n-pr", { type: "noun" }],
  ["n-pref", { type: "noun" }],
  ["n-suf", { type: "noun" }],
  ["n-t", { type: "noun" }],
  ["adj-no", { type: "noun", flag: "takesNo" }],
  // "noun or verb acting prenominally": the noun is the nearest broad type.
  ["adj-f", { type: "noun" }],
  // vs alone is the suru flag; with no other type it makes the word a noun (see describePartOfSpeech).
  ["vs", { flag: "takesSuru" }],
  ["pn", { type: "pronoun" }],
  // Adjectives. adj-pn (rentaishi) does not conjugate and modifies nouns directly:
  // na-adjective is the nearest broad type. The archaic -ku, -shiku, -kari forms conjugate as i-adjectives.
  ["adj-i", { type: "i-adjective" }],
  ["adj-ix", { type: "i-adjective" }],
  ["adj-ku", { type: "i-adjective" }],
  ["adj-shiku", { type: "i-adjective" }],
  ["adj-kari", { type: "i-adjective" }],
  ["adj-na", { type: "na-adjective" }],
  ["adj-nari", { type: "na-adjective" }],
  ["adj-t", { type: "na-adjective" }],
  ["adj-pn", { type: "na-adjective" }],
  // Adverbs. adv-to takes と.
  ["adv", { type: "adverb" }],
  ["adv-to", { type: "adverb", flag: "takesTo" }],
  // Transitivity only: no broad type of its own (describePartOfSpeech adds verb when nothing else does).
  ["vt", { direction: "transitive" }],
  ["vi", { direction: "intransitive" }],
  // Everything else with a broad type.
  ["prt", { type: "particle" }],
  ["conj", { type: "conjunction" }],
  ["int", { type: "interjection" }],
  // cop (copula, da/desu) is grouped with the auxiliaries.
  ["aux", { type: "auxiliary" }],
  ["aux-v", { type: "auxiliary" }],
  ["aux-adj", { type: "auxiliary" }],
  ["cop", { type: "auxiliary" }],
  ["ctr", { type: "counter" }],
  ["pref", { type: "prefix" }],
  ["suf", { type: "suffix" }],
  ["exp", { type: "expression" }],
  ["num", { type: "numeric" }],
  // unc: unclassified, no broad type (the one deliberate blank).
]);
for (const code of GODAN_CODES) CODE_MEANINGS.set(code, { type: "verb", verbGroup: "godan" });
for (const code of ICHIDAN_CODES) CODE_MEANINGS.set(code, { type: "verb", verbGroup: "ichidan" });
for (const code of IRREGULAR_CODES) CODE_MEANINGS.set(code, { type: "verb", verbGroup: "irregular" });
for (const code of VERB_ONLY_CODES) CODE_MEANINGS.set(code, { type: "verb" });

/**
 * A sense's codes as its Part of Speech. Unknown codes are ignored. A verb's
 * group is kept only when every verb code agrees on it. A bare `vs` counts as a
 * noun, since JMdict uses it for noun-or-participle entries that take suru.
 */
export function describePartOfSpeech(codes: readonly string[]): PartOfSpeech {
  const types = new Set<BroadPartOfSpeech>();
  const flags = new Set<PartOfSpeechFlag>();
  const groups = new Set<VerbGroup>();
  let transitive = false;
  let intransitive = false;
  for (const code of codes) {
    const meaning = CODE_MEANINGS.get(code);
    if (!meaning) continue;
    if (meaning.type) types.add(meaning.type);
    if (meaning.verbGroup) groups.add(meaning.verbGroup);
    if (meaning.direction === "transitive") transitive = true;
    if (meaning.direction === "intransitive") intransitive = true;
    if (meaning.flag) flags.add(meaning.flag);
  }
  if (types.size === 0 && flags.has("takesSuru")) types.add("noun");
  // vt and vi only say transitivity. A sense with nothing else but them is a verb.
  if (types.size === 0 && (transitive || intransitive)) types.add("verb");

  const group = groups.size === 1 ? [...groups][0] : undefined;
  // Transitivity is shown for verbs and for suru-nouns (n + vs), where whether the noun
  // is transitive is useful to a Learner. Any other word (adj-na + vi) gets none.
  const showsTransitivity = types.has("verb") || flags.has("takesSuru");
  const transitivity: Transitivity | undefined = !showsTransitivity
    ? undefined
    : transitive && intransitive
      ? "both"
      : transitive
        ? "transitive"
        : intransitive
          ? "intransitive"
          : undefined;
  return {
    types: BROAD_PARTS_OF_SPEECH.filter((type) => types.has(type)),
    ...(group && types.has("verb") ? { verbGroup: group } : {}),
    ...(transitivity ? { transitivity } : {}),
    flags: FLAG_ORDER.filter((flag) => flags.has(flag)),
  };
}

const TYPE_KEY: Record<BroadPartOfSpeech, StringKey> = {
  noun: "pos.noun",
  pronoun: "pos.pronoun",
  verb: "pos.verb",
  "i-adjective": "pos.iAdjective",
  "na-adjective": "pos.naAdjective",
  adverb: "pos.adverb",
  particle: "pos.particle",
  conjunction: "pos.conjunction",
  interjection: "pos.interjection",
  auxiliary: "pos.auxiliary",
  counter: "pos.counter",
  prefix: "pos.prefix",
  suffix: "pos.suffix",
  expression: "pos.expression",
  numeric: "pos.numeric",
};
const GROUP_KEY: Record<VerbGroup, StringKey> = {
  godan: "pos.godanVerb",
  ichidan: "pos.ichidanVerb",
  irregular: "pos.irregularVerb",
};
const TRANSITIVITY_KEY: Record<Transitivity, StringKey> = {
  transitive: "pos.transitive",
  intransitive: "pos.intransitive",
  both: "pos.bothTransitivities",
};
const FLAG_KEY: Record<PartOfSpeechFlag, StringKey> = {
  takesSuru: "pos.takesSuru",
  takesNo: "pos.takesNo",
  takesTo: "pos.takesTo",
  adverbial: "pos.adverbial",
};

/**
 * One Part of Speech as a label. `detail` is the Dictionary Entry's form: a
 * godan/ichidan/irregular verb says its group in place of "Verb", and every
 * flag shows. Without it (the Lookup row) the label is the broad type, the
 * transitivity and the suru flag only: "adj-no" and "adv-to" read as plain
 * Noun and Adverb. Returns null when there is no broad type to show.
 */
export function partOfSpeechLabel(pos: PartOfSpeech, speak: Speak, detail = true): RubyText | null {
  if (pos.types.length === 0) return null;
  const listSep = speak("pos.listSep");
  const partSep = speak("pos.partSep");
  const typeParts = pos.types.map((type) =>
    detail && type === "verb" && pos.verbGroup ? speak(GROUP_KEY[pos.verbGroup]) : speak(TYPE_KEY[type]),
  );
  let label: RubyText = [];
  typeParts.forEach((part, i) => {
    if (i > 0) label = [...label, ...listSep];
    label = [...label, ...part];
  });
  if (pos.transitivity) label = [...label, ...partSep, ...speak(TRANSITIVITY_KEY[pos.transitivity])];
  const flags = detail ? pos.flags : pos.flags.filter((flag) => flag === "takesSuru");
  for (const flag of flags) label = [...label, ...partSep, ...speak(FLAG_KEY[flag])];
  return label;
}

/** The Lookup row's label: the first sense's Part of Speech, short form. Null when the entry has no senses. */
export function shortPartOfSpeechLabel(senses: readonly SenseCodes[], speak: Speak): RubyText | null {
  const first = senses[0];
  if (!first) return null;
  return partOfSpeechLabel(describePartOfSpeech(first.partsOfSpeech), speak, false);
}

/**
 * The Dictionary Entry's label for each sense, in order: the full form, or null
 * when the sense's label equals the one above it (JMdict's importer copies a
 * sense's codes onto the senses after it that have none, so a run of senses
 * would otherwise repeat the same line).
 */
export function sensePartOfSpeechLabels(senses: readonly SenseCodes[], speak: Speak): (RubyText | null)[] {
  let above: string | null = null;
  return senses.map((sense) => {
    const label = partOfSpeechLabel(describePartOfSpeech(sense.partsOfSpeech), speak, true);
    const plain = label ? label.map((segment) => segment.text).join("") : null;
    const shown = label !== null && plain !== above ? label : null;
    above = plain;
    return shown;
  });
}
