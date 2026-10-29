import {PROVIDER_LABELS} from "@agenta/entities/secret"

// A run error as the reader should meet it: one plain sentence, the provider's raw blob a tap away.
export interface RunErrorView {
    /** What went wrong, in one sentence. */
    headline: string
    /** What to do about it, when the failure is one we recognise. */
    remedy?: string
    /** The HTTP status the provider answered with, when the text led with one. */
    status?: number
    /** Which recognised failure this is: what the reader can do about it depends on it. */
    kind?: RunErrorKind
    /** The provider's whole sentence, links removed: what the reader sees when it is short. */
    message: string
    /** The full text, for the details fold. Null when the headline already is all of it. */
    raw: string | null
}

/** A model provider the error can name, with the page where its account is topped up. */
export interface RunErrorProvider {
    /** The vault provider kind, which the provider drawer opens on. */
    kind: string
    name: string
    /** The provider's billing page: the URL in its own error when it gave one, else ours. */
    billingUrl: string
}

const PROVIDERS: {kind: string; host: string; named: RegExp; billing: string}[] = [
    {
        kind: "openrouter",
        host: "openrouter.ai",
        named: /\bopenrouter\b/i,
        billing: "https://openrouter.ai/settings/credits",
    },
    {
        kind: "openai",
        host: "openai.com",
        named: /\bopenai\b(?!-compatible)/i,
        billing: "https://platform.openai.com/settings/organization/billing/overview",
    },
    {
        kind: "anthropic",
        host: "anthropic.com",
        named: /\banthropic\b/i,
        billing: "https://console.anthropic.com/settings/billing",
    },
    {
        kind: "gemini",
        host: "generativelanguage.googleapis.com",
        named: /\bgemini\b/i,
        billing: "https://console.cloud.google.com/billing",
    },
    {
        kind: "vertex_ai",
        host: "aiplatform.googleapis.com",
        named: /\bvertex\b/i,
        billing: "https://console.cloud.google.com/billing",
    },
    {
        kind: "groq",
        host: "groq.com",
        named: /\bgroq\b/i,
        billing: "https://console.groq.com/settings/billing",
    },
]

// A sentence's closing stop is not part of the link.
const URLS = /https?:\/\/[^\s"'<>)]+[^\s"'<>).,;:!?]/gi

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname.toLowerCase()
    } catch {
        return ""
    }
}

const onHost = (host: string, base: string) => host === base || host.endsWith(`.${base}`)

/** The provider the error names, by a URL in it first and by name second. */
export const providerOf = (text: string): RunErrorProvider | null => {
    const urls = text.match(URLS) ?? []
    const found =
        PROVIDERS.find((p) => urls.some((url) => onHost(hostOf(url), p.host))) ??
        PROVIDERS.find((p) => p.named.test(text))
    if (!found) return null
    // The provider's own billing link wins: https, on its own domain, and about paying.
    const own = urls.find(
        (url) =>
            url.startsWith("https://") &&
            onHost(hostOf(url), found.host) &&
            /billing|credits|top_?up/i.test(url),
    )
    return {
        kind: found.kind,
        name: PROVIDER_LABELS[found.kind] ?? found.kind,
        billingUrl: own ?? found.billing,
    }
}

/** The failures a reader can act on, in the product's words; anything else keeps the provider's sentence. */
export type RunErrorKind = "credits" | "key" | "rate" | "outage"

const recognise = (
    status: number | undefined,
    text: string,
): {kind: RunErrorKind; headline: string; remedy: string} | null => {
    const lower = text.toLowerCase()
    const provider = providerOf(text)
    const key = provider ? `the ${provider.name} key` : "the model key"
    if (
        status === 402 ||
        /(not enough|insufficient|out of) (credits?|balance|quota)|insufficient_quota|exceeded your current quota|credit balance is too low/.test(
            lower,
        )
    ) {
        return {
            kind: "credits",
            headline: `The model provider refused the request: not enough credits on ${key}.`,
            remedy: "Add credits or pick another model, then try again.",
        }
    }
    if (status === 401 || status === 403 || /api key|unauthori[sz]ed|invalid.*key/.test(lower)) {
        return {
            kind: "key",
            headline: `The model provider rejected ${key}.`,
            remedy: "Check the key in the agent's settings, then try again.",
        }
    }
    if (status === 429 || /rate.?limit|too many requests/.test(lower)) {
        return {
            kind: "rate",
            headline: "The model provider is rate-limiting requests right now.",
            remedy: "Wait a moment, then try again.",
        }
    }
    if (
        status === 408 ||
        (status && status >= 500) ||
        /overloaded|unavailable|timed? ?out/.test(lower)
    ) {
        return {
            kind: "outage",
            headline: "The model provider isn't responding.",
            remedy: "Try again in a moment.",
        }
    }
    return null
}

const STATUS_PREFIX = /^\s*(\d{3})\s*:\s*/

/** Bounded so a hostile run of text cannot make the scan slow. */
const CODE_MARKER = /\u27e6agenta_code:[a-z_]{0,64}\u27e7/g

/** The text without the gateway's `⟦agenta_code:…⟧` markers, which are addressed to the runner. */
export const withoutCodeMarkers = (text: string): string =>
    text.replace(CODE_MARKER, "").replace(/ {2,}/g, " ").trim()

/** Sentences, each ending on its own stop: a provider's "Too Many Requests" gets a period. */
const splitSentences = (text: string): string[] =>
    text
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .map((sentence) => (/[.!?:]$/.test(sentence) ? sentence : `${sentence}.`))

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
    // The provider's JSON body, also when a harness wrapped it in words of its own.
    const open = body.indexOf("{")
    const close = body.lastIndexOf("}")
    if (open !== -1 && close > open) {
        try {
            message = messageOf(JSON.parse(body.slice(open, close + 1)))
        } catch {
            message = null
        }
    }
    // Links go to the details; a sentence a link leaves pointing at nothing ("visit") goes too.
    const said = splitSentences((message ?? body).replace(/\s+/g, " ").trim())
        .map((sentence) => {
            const unlinked = sentence.replace(/\s*https?:\/\/\S+/g, "").trim()
            if (unlinked === sentence) return sentence
            if (!unlinked || /\b(visit|see|at|here)[.:]?$/i.test(unlinked)) return ""
            return /[.!?:]$/.test(unlinked) ? unlinked : `${unlinked}.`
        })
        .filter(Boolean)
        .join(" ")
    const headline = firstSentence(said)
    const known = recognise(status, trimmed)
    const short = known?.headline ?? (headline || "Something went wrong.")
    const raw = trimmed && trimmed !== short ? trimmed : null
    return {
        headline: short,
        remedy: known?.remedy,
        status,
        kind: known?.kind,
        message: said || short,
        raw,
    }
}

/** A stacktrace or a dump: too big to read as a message, so only its first sentence is shown. */
const isBig = (text: string) => text.length > 240 || text.split("\n").length > 4

const BYTE_UNITS = ["KB", "MB", "GB"]

/** `16777216 bytes` as `16 MB`: binary units, at most one decimal. */
const humanBytes = (bytes: number): string => {
    let value = bytes
    let unit = "bytes"
    for (const next of BYTE_UNITS) {
        if (value < 1024) break
        value /= 1024
        unit = next
    }
    return `${Number(value.toFixed(1))} ${unit}`
}

/** Byte counts in units, and long numbers with thousands separators. */
export const humanizeNumbers = (text: string): string =>
    text
        .replace(/\b(\d{4,})\s*bytes\b/g, (_, n: string) => humanBytes(Number(n)))
        .replace(/\b\d{5,}\b/g, (n) => Number(n).toLocaleString("en-US"))

/** A sentence that tells the reader what to do, which reads as its own paragraph. */
const REMEDY_START =
    /^(add|ask|buy|change|check|choose|contact|pick|retry|send|sign|switch|try|update|upgrade|use|wait)\b/i

/** The server's error text, shaped as an answer: what happened, then what to do. */
export interface FormattedRunError {
    /** What happened, then what to do when the text says. */
    paragraphs: string[]
    /** The provider's own words under our sentence, when we reworded a failure we recognised. */
    quote: string | null
    /** Which recognised failure this is. */
    kind?: RunErrorKind
    /** The model provider the error names, when it names one. */
    provider: RunErrorProvider | null
    /** The server's text as it came, for the fold. Null when the message already is all of it. */
    raw: string | null
}

export const formatRunError = (
    text: string,
    {whole = false}: {whole?: boolean} = {},
): FormattedRunError => {
    // The gateway's `⟦agenta_code:…⟧` marker is for the runner, never for the reader.
    const reason = withoutCodeMarkers(text)
    const view = describeRunError(reason)
    // A finished sentence (a plan limit, a worded refusal) is shown whole; a stacktrace is cut.
    const told = humanizeNumbers(whole || !isBig(view.message) ? view.message : view.headline)
    if (view.remedy) {
        // Recognised: our sentence and remedy, with the provider's own words between them.
        const quote = told && told !== view.headline ? told : null
        return {
            paragraphs: [view.headline, view.remedy],
            quote,
            kind: view.kind,
            provider: providerOf(reason),
            raw: reason || null,
        }
    }
    const sentences = splitSentences(told)
    if (!sentences.length) {
        return {
            paragraphs: ["Something went wrong."],
            quote: null,
            provider: null,
            raw: reason || null,
        }
    }
    const cut = sentences.findIndex((sentence, i) => i > 0 && REMEDY_START.test(sentence))
    const paragraphs =
        cut > 0
            ? [sentences.slice(0, cut).join(" "), sentences.slice(cut).join(" ")]
            : [sentences.join(" ")]
    // The fold keeps the server's text when the message reworded or cut it, not for a period.
    const bare = (value: string) =>
        value
            .replace(/\s+/g, " ")
            .replace(/[.!?]$/, "")
            .trim()
    return {
        paragraphs,
        quote: null,
        provider: providerOf(reason),
        raw: bare(reason) !== bare(sentences.join(" ")) ? reason : null,
    }
}
