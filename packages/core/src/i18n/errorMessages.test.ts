// The server stays English whatever the Learner's Interface Language says:
// English keeps the server's own sentence, Japanese maps the error code to a
// translated line, and anything this client has never seen falls back to the
// server's words (issue #125).

import { describe, expect, it } from "vitest";
import { FAILED, UNREACHABLE } from "../errors.ts";
import {
  errorCode,
  errorMessage,
  EXERCISE_KINDS,
  exerciseInstruction,
  failureText,
  httpFailureText,
  ERROR_CODES,
} from "./errorMessages.ts";
import { stripRuby } from "./ruby.ts";
import { strings } from "./strings.ts";

describe("error codes", () => {
  it("every server code has a string-table entry", () => {
    for (const code of ERROR_CODES) {
      const key = `errors.${code}` as keyof typeof strings;
      expect(strings[key], `${code} has no table entry`).toBeDefined();
      expect(strings[key].en.trim()).not.toBe("");
      expect(strings[key].ja.trim()).not.toBe("");
    }
  });

  it("English always shows the server's own message", () => {
    for (const code of ERROR_CODES) {
      expect(errorMessage("en", code, "The server's own sentence")).toBe("The server's own sentence");
    }
  });

  it("Japanese answers every known code with a translated line", () => {
    for (const code of ERROR_CODES) {
      for (const lang of ["ja", "ja-furigana"] as const) {
        const line = errorMessage(lang, code, "The server's own sentence");
        expect(line, `${code} untranslated in ${lang}`).not.toBe("The server's own sentence");
        expect(line).toBe(stripRuby(strings[`errors.${code}` as keyof typeof strings].ja));
      }
    }
  });

  it("an unknown code falls back to the server's message in any language", () => {
    for (const lang of ["en", "ja", "ja-furigana"] as const) {
      expect(errorMessage(lang, "brand_new_code", "The server explained it")).toBe("The server explained it");
    }
  });

  it("a code that shadows Object.prototype falls back too", () => {
    // ERROR_STRINGS is a plain object: only own properties are translations
    // (issue #125).
    expect(errorMessage("ja", "constructor", "The server explained it")).toBe("The server explained it");
  });

  it("a missing code falls back too", () => {
    expect(errorMessage("ja", undefined, "No code on this one")).toBe("No code on this one");
    expect(errorMessage("ja", null, "No code on this one")).toBe("No code on this one");
  });

  it("reads the code off an api-client error body", () => {
    expect(errorCode({ code: "not_found", message: "No story with that id" })).toBe("not_found");
    expect(errorCode({ message: "no code here" })).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
    expect(errorCode("a string")).toBeUndefined();
  });
});

describe("the transport failure lines", () => {
  it("English keeps the sentences the hook tests pin", () => {
    expect(failureText("en")).toBe(UNREACHABLE);
    expect(failureText("en")).toBe("Cannot reach the server");
    expect(httpFailureText("en", 503)).toBe(`${FAILED} (503)`);
  });

  it("Japanese says the same in Japanese", () => {
    expect(failureText("ja")).toBe("サーバーに接続できません");
    expect(httpFailureText("ja", 503)).toBe("リクエストに失敗しました（503）");
  });
});

describe("exercise instructions", () => {
  it("every generator kind has an entry", () => {
    for (const kind of EXERCISE_KINDS) {
      const key = `exercise.${kind}` as keyof typeof strings;
      expect(strings[key], `${kind} has no table entry`).toBeDefined();
      expect(strings[key].ja.trim()).not.toBe("");
    }
  });

  it("English keeps the server's own sentence", () => {
    for (const kind of EXERCISE_KINDS) {
      const server = strings[`exercise.${kind}` as keyof typeof strings].en;
      expect(exerciseInstruction("en", kind, server)).toBe(server);
    }
  });

  it("Japanese translates the instruction", () => {
    expect(exerciseInstruction("ja", "recognition", "What does this mean?")).toBe("意味はどれですか？");
    expect(exerciseInstruction("ja-furigana", "recognition", "What does this mean?")).toBe("意味はどれですか？");
    expect(exerciseInstruction("ja", "grammar_cloze", "Which pattern completes the sentence?")).toBe(
      "文を完成させるのはどのパターンですか？",
    );
  });

  it("a kind from a newer server keeps the server's sentence", () => {
    expect(exerciseInstruction("ja", "listening", "Listen and choose")).toBe("Listen and choose");
  });

  it("a kind that shadows Object.prototype keeps the server's sentence", () => {
    // EXERCISE_STRINGS is a plain object: only own properties are
    // translations (issue #125).
    expect(exerciseInstruction("ja", "constructor", "Read and choose")).toBe("Read and choose");
  });
});
