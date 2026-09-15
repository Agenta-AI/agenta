/**
 * A run error as the reader should meet it: one plain sentence, with the raw text a tap away.
 *
 * The runner relays provider failures verbatim — `402: {"message":"…","code":402,"metadata":{…}}` —
 * and that blob is what the transcript used to paint in red. The sentence inside it is the part
 * a person can act on; the status, the URLs and the metadata are for the details.
 */
export interface RunErrorView {
    /** What went wrong, in one sentence. */
    headline: string
    /** The HTTP status the provider answered with, when the text led with one. */
    status?: number
    /** The full text, for the details fold. Null when the headline already is all of it. */
    raw: string | null
}

const STATUS_PREFIX = /^\s*(\d{3})\s*:\s*/

const firstSentence = (text: string): string => {
    const cut = text.search(/[.!?](\s|$)/)
    return cut > 0 ? text.slice(0, cut + 1) : text
}

/** `message` from a JSON body, or the body's `error.message`, however the provider nests it. */
const messageOf = (value: unknown, depth = 0): string | null => {
    if (depth > 3 || !value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    if (typeof record.message === "string" && record.message.trim()) return record.message
    if (typeof record.error === "string" && record.error.trim()) return record.error
    return messageOf(record.error, depth + 1) ?? messageOf(record.detail, depth + 1)
}

export const describeRunError = (text: string): RunErrorView => {
    const trimmed = text.trim()
    const statusMatch = STATUS_PREFIX.exec(trimmed)
    const status = statusMatch ? Number(statusMatch[1]) : undefined
    const body = statusMatch ? trimmed.slice(statusMatch[0].length) : trimmed

    let message: string | null = null
    if (body.startsWith("{")) {
        try {
            message = messageOf(JSON.parse(body))
        } catch {
            message = null
        }
    }
    // A URL in the sentence belongs to the details, not the headline.
    const headline = firstSentence((message ?? body).replace(/\s*https?:\/\/\S+/g, "").trim())
        .replace(/\s+/g, " ")
        .trim()
    const short = headline || "Something went wrong."
    const raw = trimmed && trimmed !== short ? trimmed : null
    return {headline: short, status, raw}
}
