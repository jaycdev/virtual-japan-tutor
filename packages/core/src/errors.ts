/**
 * The two Learner-facing failure lines shared by every API hook: a transport
 * failure (no response at all) and any other failed request before the
 * server's own message takes over. They lived as a private pair in each
 * hook; one module keeps a rewording a single edit (branch review). They are
 * now string-table entries (issue #125) so the Japanese UI says the same
 * thing in Japanese; hooks take the language from useInterfaceLanguage().
 *
 * The plain constants stay for English-only call sites and tests.
 */

import { translatePlain } from "./i18n/translate.ts";
import { errorMessage, errorCode, failureText, httpFailureText } from "./i18n/errorMessages.ts";

/** No response came back: offline, DNS dead, the server down. */
export const UNREACHABLE = translatePlain("en", "errors.unreachable");

/** A failed request with nothing more useful to show than its status. */
export const FAILED = translatePlain("en", "errors.failed");

/** The line for a failed request, mapped from the server's error code. */
export { errorMessage, errorCode, failureText, httpFailureText };

/** The instruction over a practice exercise, translated per Interface Language. */
export { exerciseInstruction } from "./i18n/errorMessages.ts";
