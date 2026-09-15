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
    /** What to do about it, when the failure is one we recognise. */
    remedy?: string
    /** The HTTP status the provider answered with, when the text led with one. */
    status?: number
    /** The full text, for the details fold. Null when the headline already is all of it. */
    raw: string | null
}

/** The provider a URL in the error names, for a sentence that says whose key it is. */
const providerOf = (text: string): string | null => {
    const host = /https?:\/\/([a-z0-9.-]+)/i.exec(text)?.[1]?.toLowerCase() ?? ""
    if (host.includes("openrouter")) return "OpenRouter"
    if (host.includes("openai")) return "OpenAI"
    if (host.includes("anthropic")) return "Anthropic"
    if (host.includes("googleapis")) return "Google"
    return null
}

/**
 * The failures a reader can do something about, said in the product's words. Anything else
 * keeps the provider's own sentence.
 */
const recognise = (
    status: number | undefined,
    text: string,
): {headline: string; remedy: string} | null => {
    const lower = text.toLowerCase()
    const provider = providerOf(text)
    const key = provider ? `the ${provider} key` : "the model key"
    if (status === 402 || /credits|insufficient.*(balance|quota)|billing/.test(lower)) {
        return {
            headline: `The model provider refused the request: not enough credits on ${key}.`,
            remedy: "Add credits or pick another model, then try again.",
        }
    }
    if (status === 401 || status === 403 || /api key|unauthori[sz]ed|invalid.*key/.test(lower)) {
        return {
            headline: `The model provider rejected ${key}.`,
            remedy: "Check the key in the agent's settings, then try again.",
        }
    }
    if (status === 429 || /rate.?limit|too many requests/.test(lower)) {
        return {
            headline: "The model provider is rate-limiting requests right now.",
            remedy: "Wait a moment, then try again.",
        }
    }
    if ((status && status >= 500) || /overloaded|unavailable|timed? ?out/.test(lower)) {
        return {
            headline: "The model provider isn't responding.",
            remedy: "Try again in a moment.",
        }
    }
    return null
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
    const known = recognise(status, trimmed)
    const short = known?.headline ?? (headline || "Something went wrong.")
    const raw = trimmed && trimmed !== short ? trimmed : null
    return {headline: short, remedy: known?.remedy, status, raw}
}
