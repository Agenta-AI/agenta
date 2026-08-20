/**
 * The session name this run proposes to the coordination plane.
 *
 * A session is named by the browser today, so any run no browser ever rendered (a headless
 * invoke, a scheduled trigger) stays untitled forever. The runner is the one place every
 * execution path passes through holding both the session id and the user's first message, so it
 * proposes a name on the heartbeat; the server fills it only while the stored name is NULL, and
 * a rename or the browser's own auto-title always wins by overwriting.
 */
import { type AgentRunRequest, messageText } from "../protocol.ts";

/** Mirrors the browser auto-title's `AUTO_TITLE_MAX_CHARS` so both writers produce one string. */
const NAME_MAX_CODE_POINTS = 60;

/**
 * The first user message's text, trimmed and capped. Undefined when the request carries no
 * readable user text at all (an attachment- or image-only turn, or a resume whose tail is a
 * tool envelope) — a session is better untitled than titled with an empty string.
 */
export function proposeSessionName(
  request: AgentRunRequest,
): string | undefined {
  for (const message of request.messages ?? []) {
    if (message?.role !== "user") continue;
    const text = messageText(message.content).trim();
    if (!text) continue;
    // Cut on code points, not UTF-16 units, so an emoji straddling the cap isn't halved.
    return Array.from(text).slice(0, NAME_MAX_CODE_POINTS).join("");
  }
  return undefined;
}
