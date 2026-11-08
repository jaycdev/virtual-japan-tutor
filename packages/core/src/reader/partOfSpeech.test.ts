// The Part of Speech mapping (issue #132): JMdict codes to broad types, verb
// groups, transitivity and flags, and the labels the Lookup row and the
// Dictionary Entry show in each Interface Language.

import { describe, expect, it } from "vitest";
import { isKanji, parseRuby, stripRuby } from "../i18n/ruby.ts";
import { strings, type StringKey } from "../i18n/strings.ts";
import { translate } from "../i18n/translate.ts";
import type { InterfaceLanguage } from "../i18n/language.ts";
import {
  BROAD_PARTS_OF_SPEECH,
  describePartOfSpeech,
  partOfSpeechLabel,
  sensePartOfSpeechLabels,
  shortPartOfSpeechLabel,
  type PartOfSpeech,
  type Speak,
} from "./partOfSpeech.ts";

const speakIn = (lang: InterfaceLanguage): Speak => (key: StringKey) => translate(lang, key);
const en = speakIn("en");
const ja = speakIn("ja");
const furigana = speakIn("ja-furigana");

const plain = (segments: ReturnType<Speak> | null | undefined): string | null =>
  segments ? segments.map((s) => s.text).join("") : null;

/** Every JMdict part-of-speech entity code (JMdict_e's DTD). */
const JMDICT_CODES = [
  "adj-f", "adj-i", "adj-ix", "adj-kari", "adj-ku", "adj-na", "adj-nari", "adj-no", "adj-pn", "adj-shiku", "adj-t",
  "adv", "adv-to", "aux", "aux-adj", "aux-v", "conj", "cop", "ctr", "exp", "int", "n", "n-adv", "n-pr", "n-pref",
  "n-suf", "n-t", "num", "pn", "pref", "prt", "suf", "unc", "v-unspec", "v1", "v1-s",
  "v2a-s", "v2b-k", "v2b-s", "v2d-k", "v2d-s", "v2g-k", "v2g-s", "v2h-k", "v2h-s", "v2k-k", "v2k-s", "v2m-k",
  "v2m-s", "v2n-s", "v2r-k", "v2r-s", "v2s-s", "v2t-k", "v2t-s", "v2w-s", "v2y-k", "v2y-s", "v2z-s",
  "v4b", "v4g", "v4h", "v4k", "v4m", "v4n", "v4r", "v4s", "v4t",
  "v5aru", "v5b", "v5g", "v5k", "v5k-s", "v5m", "v5n", "v5r", "v5r-i", "v5s", "v5t", "v5u", "v5u-s", "v5uru",
  "vi", "vk", "vn", "vr", "vs", "vs-c", "vs-i", "vs-s", "vt", "vz",
];

describe("the broad type of every JMdict code", () => {
  const expected: Record<string, PartOfSpeech["types"]> = {
    n: ["noun"], "n-pr": ["noun"], "n-pref": ["noun"], "n-suf": ["noun"], "n-t": ["noun"], "n-adv": ["noun"],
    pn: ["pronoun"],
    "adj-i": ["i-adjective"], "adj-ix": ["i-adjective"], "adj-kari": ["i-adjective"], "adj-ku": ["i-adjective"],
    "adj-shiku": ["i-adjective"],
    "adj-na": ["na-adjective"], "adj-nari": ["na-adjective"], "adj-t": ["na-adjective"], "adj-pn": ["na-adjective"],
    "adj-no": ["noun"], "adj-f": ["noun"],
    adv: ["adverb"], "adv-to": ["adverb"],
    prt: ["particle"], conj: ["conjunction"], int: ["interjection"],
    aux: ["auxiliary"], "aux-v": ["auxiliary"], "aux-adj": ["auxiliary"], cop: ["auxiliary"],
    ctr: ["counter"], pref: ["prefix"], suf: ["suffix"], exp: ["expression"], num: ["numeric"],
    vs: ["noun"],
    unc: [],
  };

  it("maps each code to its nearest broad type", () => {
    for (const [code, types] of Object.entries(expected)) {
      expect(describePartOfSpeech([code]).types, code).toEqual(types);
    }
  });

  it("maps every verb code to verb", () => {
    for (const code of JMDICT_CODES.filter((c) => /^v/.test(c) && c !== "vs")) {
      expect(describePartOfSpeech([code]).types, code).toEqual(["verb"]);
    }
  });

  it("handles every JMdict code deliberately: only unc has no broad type", () => {
    for (const code of JMDICT_CODES) {
      const { types, flags } = describePartOfSpeech([code]);
      if (code === "unc") {
        expect(types).toEqual([]);
      } else {
        expect(types.length + flags.length, `${code} has no meaning`).toBeGreaterThan(0);
      }
    }
  });

  it("ignores codes it does not know, without failing", () => {
    expect(describePartOfSpeech(["not-a-code", "n"])).toEqual({ types: ["noun"], flags: [] });
    expect(describePartOfSpeech(["constructor", "toString"])).toEqual({ types: [], flags: [] });
  });

  it("lists the broad types in display order, deduplicated", () => {
    expect(describePartOfSpeech(["adj-na", "n", "n", "pn"]).types).toEqual(["noun", "pronoun", "na-adjective"]);
    expect(BROAD_PARTS_OF_SPEECH[0]).toBe("noun");
  });
});

describe("verb groups", () => {
  it("names godan for every v5 code, including the irregular-looking ones", () => {
    for (const code of ["v5r", "v5u", "v5k-s", "v5r-i", "v5aru", "v5uru", "v5u-s"]) {
      expect(describePartOfSpeech([code]).verbGroup, code).toBe("godan");
    }
  });

  it("names ichidan for v1, v1-s and vz", () => {
    for (const code of ["v1", "v1-s", "vz"]) {
      expect(describePartOfSpeech([code]).verbGroup, code).toBe("ichidan");
    }
  });

  it("names irregular for kuru, the nu verbs and the suru family", () => {
    for (const code of ["vk", "vn", "vs-i", "vs-s", "vs-c"]) {
      expect(describePartOfSpeech([code]).verbGroup, code).toBe("irregular");
    }
  });

  it("leaves the archaic classes and the unspecified verb without a group", () => {
    for (const code of ["v2a-s", "v2k-k", "v4k", "v4r", "v-unspec"]) {
      const pos = describePartOfSpeech([code]);
      expect(pos.types, code).toEqual(["verb"]);
      expect(pos.verbGroup, code).toBeUndefined();
    }
  });

  it("keeps the group only when every verb code agrees", () => {
    expect(describePartOfSpeech(["v1", "v5r"]).verbGroup).toBeUndefined();
    expect(describePartOfSpeech(["v5r", "v5r"]).verbGroup).toBe("godan");
  });

  it("gives no group to a noun that is not a verb", () => {
    expect(describePartOfSpeech(["n", "v1"]).verbGroup).toBe("ichidan");
    expect(describePartOfSpeech(["n"]).verbGroup).toBeUndefined();
  });
});

describe("transitivity", () => {
  it("reads vt as transitive and vi as intransitive", () => {
    expect(describePartOfSpeech(["v1", "vt"]).transitivity).toBe("transitive");
    expect(describePartOfSpeech(["v5u", "vi"]).transitivity).toBe("intransitive");
  });

  it("says both when a sense carries vt and vi", () => {
    expect(describePartOfSpeech(["v5r", "vt", "vi"]).transitivity).toBe("both");
  });

  it("says nothing for a verb with neither code", () => {
    expect(describePartOfSpeech(["v1"]).transitivity).toBeUndefined();
    expect(describePartOfSpeech(["n"]).transitivity).toBeUndefined();
  });
});

describe("transitivity on suru-nouns and non-verbs", () => {
  it("keeps the transitivity of a suru-noun, with vi or vt", () => {
    expect(describePartOfSpeech(["n", "vs", "vi"])).toEqual({
      types: ["noun"],
      transitivity: "intransitive",
      flags: ["takesSuru"],
    });
    expect(describePartOfSpeech(["n", "vs", "vt"])).toEqual({
      types: ["noun"],
      transitivity: "transitive",
      flags: ["takesSuru"],
    });
  });

  it("does not make a suru-noun a verb: vt and vi add no verb type", () => {
    expect(describePartOfSpeech(["n", "vs", "vi"]).types).toEqual(["noun"]);
    expect(describePartOfSpeech(["n", "vs", "vt"]).verbGroup).toBeUndefined();
  });

  it("gives a non-verb with vi no transitivity", () => {
    expect(describePartOfSpeech(["adj-na", "vi"])).toEqual({ types: ["na-adjective"], flags: [] });
  });

  it("gives a noun with vt, and no suru flag, no transitivity", () => {
    expect(describePartOfSpeech(["n", "vt"])).toEqual({ types: ["noun"], flags: [] });
  });

  it("treats a sense with only vt or vi as a verb", () => {
    expect(describePartOfSpeech(["vi"])).toEqual({ types: ["verb"], transitivity: "intransitive", flags: [] });
    expect(describePartOfSpeech(["vt"])).toEqual({ types: ["verb"], transitivity: "transitive", flags: [] });
  });

  it("shows the suru-noun's transitivity in the Lookup row and the Dictionary Entry", () => {
    const intransitive = [{ partsOfSpeech: ["n", "vs", "vi"] }];
    expect(plain(shortPartOfSpeechLabel(intransitive, en))).toBe("Noun · intransitive · takes する");
    expect(plain(sensePartOfSpeechLabels(intransitive, en)[0])).toBe("Noun · intransitive · takes する");
    const transitive = [{ partsOfSpeech: ["n", "vs", "vt"] }];
    expect(plain(shortPartOfSpeechLabel(transitive, en))).toBe("Noun · transitive · takes する");
    expect(plain(sensePartOfSpeechLabels(transitive, en)[0])).toBe("Noun · transitive · takes する");
  });

  it("shows no transitivity for a non-verb with vi", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["adj-na", "vi"] }], en))).toBe("na-adjective");
    expect(plain(sensePartOfSpeechLabels([{ partsOfSpeech: ["adj-na", "vi"] }], en)[0])).toBe("na-adjective");
  });
});

describe("flags", () => {
  it("reads vs as takes する, on a noun", () => {
    expect(describePartOfSpeech(["n", "vs"])).toEqual({ types: ["noun"], flags: ["takesSuru"] });
  });

  it("makes a bare vs a noun that takes する", () => {
    expect(describePartOfSpeech(["vs"])).toEqual({ types: ["noun"], flags: ["takesSuru"] });
  });

  it("reads adj-no as takes の, on a noun", () => {
    expect(describePartOfSpeech(["adj-no"])).toEqual({ types: ["noun"], flags: ["takesNo"] });
  });

  it("reads adv-to as takes と, on an adverb", () => {
    expect(describePartOfSpeech(["adv-to"])).toEqual({ types: ["adverb"], flags: ["takesTo"] });
  });

  it("reads n-adv as a noun that can be used as an adverb", () => {
    expect(describePartOfSpeech(["n-adv"])).toEqual({ types: ["noun"], flags: ["adverbial"] });
  });

  it("keeps the flags in a fixed order", () => {
    expect(describePartOfSpeech(["adv-to", "n-adv", "n", "adj-no", "vs"]).flags).toEqual([
      "takesSuru",
      "takesNo",
      "takesTo",
      "adverbial",
    ]);
  });
});

describe("the Lookup row's label: the first sense, short form", () => {
  it("reads a transitive verb as Verb · transitive", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["v1", "vt"] }], en))).toBe("Verb · transitive");
  });

  it("drops the verb group in the short form", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["v5r", "vi"] }], en))).toBe("Verb · intransitive");
  });

  it("reads a verb with both transitivities as Verb · transitive & intransitive", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["v5r", "vt", "vi"] }], en))).toBe(
      "Verb · transitive & intransitive",
    );
  });

  it("reads a suru noun as Noun · takes する", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["n", "vs"] }], en))).toBe("Noun · takes する");
  });

  it("shows adv-to as just Adverb", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["adv-to"] }], en))).toBe("Adverb");
  });

  it("drops the adj-no and n-adv flags in the short form", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["adj-no"] }], en))).toBe("Noun");
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["n-adv"] }], en))).toBe("Noun");
  });

  it("shows a bare na-adjective", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["adj-na"] }], en))).toBe("na-adjective");
  });

  it("reads only the first sense", () => {
    const senses = [{ partsOfSpeech: ["n"] }, { partsOfSpeech: ["v1", "vt"] }];
    expect(plain(shortPartOfSpeechLabel(senses, en))).toBe("Noun");
  });

  it("is null for an entry with no senses, or a first sense with no type", () => {
    expect(shortPartOfSpeechLabel([], en)).toBeNull();
    expect(shortPartOfSpeechLabel([{ partsOfSpeech: ["unc"] }], en)).toBeNull();
    expect(shortPartOfSpeechLabel([{ partsOfSpeech: [] }, { partsOfSpeech: ["n"] }], en)).toBeNull();
  });
});

describe("the Dictionary Entry's label: the full form", () => {
  it("names the verb group in place of Verb", () => {
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["v5r", "vt"]), en))).toBe("Godan verb · transitive");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["v1", "vi"]), en))).toBe("Ichidan verb · intransitive");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["vs-i"]), en))).toBe("Irregular verb");
  });

  it("shows every flag", () => {
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["n", "vs"]), en))).toBe("Noun · takes する");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["adj-no"]), en))).toBe("Noun · takes の");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["adv-to"]), en))).toBe("Adverb · takes と");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["n-adv"]), en))).toBe(
      "Noun · can be used as an adverb",
    );
  });

  it("joins several broad types in display order", () => {
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["adj-na", "n"]), en))).toBe("Noun, na-adjective");
  });

  it("leaves an archaic verb as its broad type", () => {
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["v2k-k", "vt"]), en))).toBe("Verb · transitive");
  });

  it("is null for a Part of Speech with no type", () => {
    expect(partOfSpeechLabel(describePartOfSpeech(["unc"]), en)).toBeNull();
  });
});

describe("the labels in Japanese", () => {
  it("writes the full form in Japanese, with its furigana kept only in ja-furigana", () => {
    const pos = describePartOfSpeech(["v5r", "vt"]);
    expect(plain(partOfSpeechLabel(pos, ja))).toBe("五段動詞・他動詞");
    expect(plain(partOfSpeechLabel(pos, furigana))).toBe("五段動詞・他動詞");
    const segments = partOfSpeechLabel(pos, furigana) ?? [];
    expect(segments.some((s) => s.text === "五段動詞" && s.ruby === "ごだんどうし")).toBe(true);
    expect(segments.some((s) => s.ruby !== undefined)).toBe(true);
    expect(partOfSpeechLabel(pos, ja)?.some((s) => s.ruby !== undefined)).toBe(false);
  });

  it("writes the flags in Japanese", () => {
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["n", "vs"]), ja))).toBe("名詞・「する」を伴う");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["adj-no"]), ja))).toBe("名詞・「の」を伴う");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["adv-to"]), ja))).toBe("副詞・「と」を伴う");
    expect(plain(partOfSpeechLabel(describePartOfSpeech(["n-adv"]), ja))).toBe("名詞・副詞としても使う");
  });

  it("writes the Lookup row's short label in Japanese", () => {
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["v1", "vt"] }], ja))).toBe("動詞・他動詞");
    expect(plain(shortPartOfSpeechLabel([{ partsOfSpeech: ["adv-to"] }], ja))).toBe("副詞");
  });

  it("keeps the readings over the kanji in ja-furigana for every Part of Speech label", () => {
    for (const key of Object.keys(strings) as StringKey[]) {
      if (!key.startsWith("pos.")) continue;
      for (const segment of parseRuby(strings[key].ja)) {
        if (segment.ruby === undefined) {
          expect([...segment.text].filter(isKanji), key).toEqual([]);
        }
      }
      expect(stripRuby(strings[key].ja), key).toBe(translate("ja", key).map((s) => s.text).join(""));
    }
  });
});

describe("sensePartOfSpeechLabels", () => {
  it("shows a label once and drops it where it repeats the sense above", () => {
    const senses = [
      { partsOfSpeech: ["v5r", "vt"] },
      { partsOfSpeech: ["v5r", "vt"] },
      { partsOfSpeech: ["n"] },
      { partsOfSpeech: ["n"] },
    ];
    const labels = sensePartOfSpeechLabels(senses, en).map(plain);
    expect(labels).toEqual(["Godan verb · transitive", null, "Noun", null]);
  });

  it("shows a label again after a sense with none", () => {
    const senses = [{ partsOfSpeech: ["n"] }, { partsOfSpeech: ["unc"] }, { partsOfSpeech: ["n"] }];
    expect(sensePartOfSpeechLabels(senses, en).map(plain)).toEqual(["Noun", null, "Noun"]);
  });

  it("gives null for a sense with no Part of Speech", () => {
    expect(sensePartOfSpeechLabels([{ partsOfSpeech: [] }], en)).toEqual([null]);
  });

  it("follows the Interface Language", () => {
    const senses = [{ partsOfSpeech: ["adj-na"] }];
    expect(sensePartOfSpeechLabels(senses, ja).map(plain)).toEqual(["な形容詞"]);
  });
});
