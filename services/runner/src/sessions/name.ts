/**
 * The session name this run proposes to the coordination plane.
 *
 * A session is named by the browser today, so any run no browser ever rendered (a headless
 * invoke, a scheduled trigger) stays untitled forever. The runner is the one place every
 * execution path passes through holding both the session id and the user's first message, so it
 * proposes a name on the heartbeat; the server fills it only while the stored name is NULL, and
 * a rename or the browser's own auto-title always wins by overwriting.
 */
import {
  type AgentRunRequest,
  type ChatMessage,
  messageText,
} from "../protocol.ts";

/** Mirrors the browser auto-title's `AUTO_TITLE_MAX_CHARS` so both writers produce one string. */
const NAME_MAX_CODE_POINTS = 60;

/** The line the composer appends for each file it saved to the session drive instead of
 * attaching (@agenta/chat `withDriveFileNote`). It is not the user's words, so it never names
 * the session. */
const DRIVE_FILE_NOTE_PREFIX =
  "Uploaded to the session drive (too large to attach):";

const withoutDriveFileNotes = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith(DRIVE_FILE_NOTE_PREFIX))
    .join("\n");

/**
 * The words the person wrote. A channel turn (Slack, Telegram, the embed) adds a "From ..."
 * attribution line and host context to `content` for the model, and keeps the person's own words in
 * `display_content`, which is also what the chat shows. A null `display_content` hides the
 * message in chat but says nothing about its words, so the name falls back to `content`.
 */
const personText = (message: ChatMessage): string =>
  typeof message.display_content === "string"
    ? message.display_content
    : messageText(message.content);

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
    const text = withoutDriveFileNotes(personText(message)).trim();
    if (!text) continue;
    // Cut on code points, not UTF-16 units, so an emoji straddling the cap isn't halved.
    return Array.from(text).slice(0, NAME_MAX_CODE_POINTS).join("");
  }
  return undefined;
}
