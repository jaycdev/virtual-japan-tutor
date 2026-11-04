/**
 * Pure text helpers for the Practice Session screens, shared by web and mobile
 * (issue #78 moved them here from apps/mobile so both apps render prompts and
 * seeds the same way).
 */

/**
 * A deterministic session seed for a Story id (the reader's "Practice this
 * Story" link). The API's PracticeSessionStart takes only an integer seed, not
 * a Story reference, so the client derives one from the id: the same Story and
 * Focus Set produce the same session, and retrying the link never reshuffles it.
 *
 * Plainly said (backend issue #57): this hash is a stand-in until the API
 * accepts a storyId on POST /practice/sessions and draws exercises from that
 * Story's vocabulary. When that lands, delete this function and pass the Story
 * id through. Until then, the exercises come from the Learner's Focus Set, not
 * the Story.
 */
export function practiceSeedForStory(storyId: string): number {
  let hash = 5381;
  for (let i = 0; i < storyId.length; i += 1) hash = ((hash << 5) + hash + storyId.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * Cloze prompts break mid-token at narrow widths, stranding "＿＿＿。" on a
 * line of its own (#46 review P3). U+2060 WORD JOINER is zero-width and
 * forbids a break where it sits: one glues the blank to its punctuation, the
 * other ties the token to the word before it.
 */
export function displayPrompt(prompt: string): string {
  return prompt
    .replace(/([＿_]+)[\s\u2060]*([。、．.!?！？])/gu, "$1\u2060$2")
    .replace(/(\s)([＿_])/gu, "$1\u2060$2");
}
