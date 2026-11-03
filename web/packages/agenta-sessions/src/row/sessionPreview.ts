import type {SessionStream} from "@agenta/entities/session"

/** A row is one line of preview; anything past this is truncated by CSS anyway. */
const MAX_LENGTH = 160

/**
 * The last thing said in a session, as a row subtitle.
 *
 * Human messages are prefixed because the row already names the agent beside them — an
 * unprefixed preview of "check my emails" reads as something the agent said. `record_source`
 * distinguishes the human side from the agent's, but records carry no author id, so this can't
 * tell your message from a teammate's in a shared project.
 */
export function sessionPreviewText(row: SessionStream): string | null {
    const message = row.last_message
    // Newlines would either break the row or render as a space run inside a single line.
    const text = message?.text?.replace(/\s+/g, " ").trim()
    if (!text) return null

    const clipped = text.length <= MAX_LENGTH ? text : `${text.slice(0, MAX_LENGTH).trimEnd()}…`
    return message?.source === "user" ? `You: ${clipped}` : clipped
}
