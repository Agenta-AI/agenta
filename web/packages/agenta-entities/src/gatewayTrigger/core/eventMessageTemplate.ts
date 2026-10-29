/**
 * Token-template ⇆ `inputs_fields` for the subscription "What the agent gets" composer.
 *
 * A non-technical user writes a message and drops in event fields as `{{path}}` tokens.
 * We compile that to a backend-resolvable `inputs_fields`: a chat user message (or the
 * completion agent's primary input) whose `content` is EITHER a single string (one literal
 * or one `$.selector`) OR an array of text parts — literal runs kept, `$.selector` runs
 * resolved leaf-by-leaf at delivery by `resolve_target_fields`. No backend change: it's the
 * same whole-string-or-literal leaf resolution, just structured as parts.
 *
 * Display ≠ storage: the editor shows `{{event.attributes.body}}`; we store
 * `{type:"text", text:"$.event.attributes.body"}`. Other keys of the mapping are kept.
 */

export interface TemplateSegment {
    literal?: string
    selector?: string
}

// `{{ path }}` tokens. The inner path is a JSONPath/Pointer or a dot path (→ `$.path`).
// No \s* around the capture (ReDoS-ambiguous with [^{}]); `tokenToSelector` trims instead.
const TOKEN_RE = /\{\{([^{}]+)\}\}/g

function tokenToSelector(token: string): string {
    const t = token.trim()
    if (!t) return ""
    if (t.startsWith("$") || t.startsWith("/")) return t
    return `$.${t}`
}

function selectorToToken(selector: string): string {
    if (selector === "$") return "{{$}}"
    if (selector.startsWith("$.")) return `{{${selector.slice(2)}}}`
    return `{{${selector}}}`
}

/** Split a template string into literal + selector segments (in order). */
export function splitTemplate(template: string): TemplateSegment[] {
    const segments: TemplateSegment[] = []
    let last = 0
    let m: RegExpExecArray | null
    TOKEN_RE.lastIndex = 0
    while ((m = TOKEN_RE.exec(template)) !== null) {
        if (m.index > last) segments.push({literal: template.slice(last, m.index)})
        const selector = tokenToSelector(m[1])
        if (selector) segments.push({selector})
        last = m.index + m[0].length
    }
    if (last < template.length) segments.push({literal: template.slice(last)})
    return segments
}

// Segments → a message `content`: "" when empty, a bare string for one literal (or one selector
// when `pillsAsParts` is off), else an array of resolvable text parts.
function segmentsToContent(
    segments: TemplateSegment[],
    pillsAsParts: boolean,
): string | {type: "text"; text: string}[] {
    const nonEmpty = segments.filter((s) => (s.selector ?? s.literal ?? "") !== "")
    if (nonEmpty.length === 0) return ""
    const only = nonEmpty.length === 1 ? nonEmpty[0] : null
    if (only && (only.literal !== undefined || !pillsAsParts))
        return only.selector ?? only.literal ?? ""
    return nonEmpty.map((s) => ({type: "text" as const, text: s.selector ?? s.literal ?? ""}))
}

/** The selectors a template uses, in order; the field tags mark these as used. */
export function templateSelectors(template: string): string[] {
    return splitTemplate(template).flatMap((s) => (s.selector ? [s.selector] : []))
}

function parseObject(inputsText: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = inputsText.trim() ? JSON.parse(inputsText) : {}
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null
    } catch {
        return null
    }
}

// A `messages` payload edits as chat even when the schema says completion, like `messageInputs`.
function messageKey(obj: Record<string, unknown>, isChat: boolean, primaryKey: string): string {
    return isChat || Array.isArray(obj.messages) ? "messages" : primaryKey
}

/**
 * Write a token template into `inputs_fields`, returning the serialized JSON. Only the message
 * key changes: chat agents get one `messages` user message, completion agents the primary key.
 * In `messages`, a pill is always a text part, even alone. Every other key is kept. An empty
 * template removes the message key.
 */
export function compileMessageTemplate(
    inputsText: string,
    template: string,
    isChat: boolean,
    primaryKey: string,
): string {
    const obj = parseObject(inputsText) ?? {}
    const key = messageKey(obj, isChat, primaryKey)
    // A bare selector on an array field would become the message parts; a text part keeps it text.
    const content = template.trim()
        ? segmentsToContent(splitTemplate(template), key === "messages")
        : ""
    if (content === "") delete obj[key]
    else obj[key] = key === "messages" ? [{role: "user", content}] : content
    return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : "{}"
}

// A content value the composer can REPRODUCE: a plain string, or an array of strictly
// `{type:"text", text}` parts (what `segmentsToContent` emits). Returns the template, or null
// when not representable (an image/audio part, or a malformed object) so callers don't show —
// then silently collapse — a payload they can't round-trip.
function contentToTemplate(content: unknown): string | null {
    if (typeof content === "string") {
        return content.startsWith("$") || content.startsWith("/")
            ? selectorToToken(content)
            : content
    }
    if (Array.isArray(content)) {
        const parts: string[] = []
        for (const p of content) {
            if (
                !p ||
                typeof p !== "object" ||
                (p as {type?: unknown}).type !== "text" ||
                typeof (p as {text?: unknown}).text !== "string"
            ) {
                return null
            }
            const text = (p as {text: string}).text
            parts.push(text.startsWith("$") || text.startsWith("/") ? selectorToToken(text) : text)
        }
        return parts.join("")
    }
    return null
}

/**
 * Read `inputs_fields` (serialized JSON) back into a token template for the editor. Keys other
 * than the message key are ignored. Returns "" when there is no message yet, and null when the
 * composer cannot show the mapping (several messages, a non-user message, a non-text part).
 */
export function parseMessageTemplate(
    inputsText: string,
    isChat: boolean,
    primaryKey: string,
): string | null {
    const obj = parseObject(inputsText)
    if (!obj) return null
    const key = messageKey(obj, isChat, primaryKey)
    if (!(key in obj)) return ""
    if (key !== "messages") return contentToTemplate(obj[key])
    const messages = obj.messages
    if (!Array.isArray(messages) || messages.length !== 1) return null
    const message = messages[0]
    if (!message || typeof message !== "object" || (message as {role?: string}).role !== "user")
        return null
    return contentToTemplate((message as {content?: unknown}).content)
}

/**
 * Move the template to a new agent input shape once the bound agent resolves. The old key is
 * removed, other keys are kept, and a mapping the composer cannot show is returned unchanged.
 */
export function remapMessageTemplate(
    inputsText: string,
    prev: {isChat: boolean; primaryKey: string},
    next: {isChat: boolean; primaryKey: string},
): string {
    const template = parseMessageTemplate(inputsText, prev.isChat, prev.primaryKey)
    if (!template) return inputsText
    const obj = parseObject(inputsText) ?? {}
    delete obj[messageKey(obj, prev.isChat, prev.primaryKey)]
    return compileMessageTemplate(JSON.stringify(obj), template, next.isChat, next.primaryKey)
}
