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
 * `{type:"text", text:"$.event.attributes.body"}`.
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

// Segments → a message `content`: "" when empty, a bare string when there's a single
// literal/selector, else an array of resolvable text parts.
function segmentsToContent(segments: TemplateSegment[]): string | {type: "text"; text: string}[] {
    const nonEmpty = segments.filter((s) => (s.selector ?? s.literal ?? "") !== "")
    if (nonEmpty.length === 0) return ""
    if (nonEmpty.length === 1) return nonEmpty[0].selector ?? nonEmpty[0].literal ?? ""
    return nonEmpty.map((s) => ({type: "text" as const, text: s.selector ?? s.literal ?? ""}))
}

/**
 * Compile a token template into `inputs_fields`. Chat agents → a `messages` user message;
 * completion agents → the primary input key. Empty template → `{}`.
 */
export function compileMessageTemplate(
    template: string,
    isChat: boolean,
    primaryKey: string,
): Record<string, unknown> {
    if (!template.trim()) return {}
    const content = segmentsToContent(splitTemplate(template))
    if (content === "") return {}
    if (isChat) return {messages: [{role: "user", content}]}
    return {[primaryKey]: content}
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
 * Parse `inputs_fields` (serialized JSON) back into a token template for the editor. Returns ""
 * unless the mapping is EXACTLY what `compileMessageTemplate` emits — a single `{role:"user"}`
 * message (chat) / the one `primaryKey` (completion) with representable content, and no other
 * keys. Anything else (multi-message, system/assistant, non-text parts, extra keys) isn't
 * representable; the caller falls back to the raw-JSON Advanced editor instead of collapsing it.
 */
export function parseMessageTemplate(
    inputsText: string,
    isChat: boolean,
    primaryKey: string,
): string {
    let parsed: unknown
    try {
        parsed = inputsText.trim() ? JSON.parse(inputsText) : {}
    } catch {
        return ""
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ""
    const obj = parsed as Record<string, unknown>
    const keys = Object.keys(obj)
    if (isChat) {
        if (keys.length !== 1 || keys[0] !== "messages") return ""
        const messages = obj.messages
        if (!Array.isArray(messages) || messages.length !== 1) return ""
        const message = messages[0]
        if (!message || typeof message !== "object" || (message as {role?: string}).role !== "user")
            return ""
        return contentToTemplate((message as {content?: unknown}).content) ?? ""
    }
    if (keys.length !== 1 || keys[0] !== primaryKey) return ""
    return contentToTemplate(obj[primaryKey]) ?? ""
}
