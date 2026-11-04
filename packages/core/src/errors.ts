/**
 * The two Learner-facing failure lines shared by every API hook: a transport
 * failure (no response at all) and any other failed request before the
 * server's own message takes over. They lived as a private pair in each
 * hook; one module keeps a rewording a single edit (branch review).
 *
 * Internal to @vjt/core — deliberately not re-exported from the index.
 */

/** No response came back: offline, DNS dead, the server down. */
export const UNREACHABLE = "Cannot reach the server";

/** A failed request with nothing more useful to show than its status. */
export const FAILED = "Request failed";
