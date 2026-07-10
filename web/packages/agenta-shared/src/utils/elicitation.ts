/**
 * Elicitation contract (chat interaction kinds, M1).
 *
 * The `elicitation` render kind lets a platform op request typed input mid-run: the wire
 * carries `{message, requestedSchema}` (the MCP-elicitation FLAT dialect — top-level
 * primitives/enums only, plus `x-ag-*` presentation hints), the chat renders a form, and the
 * settling tool result carries `{action: accept|decline|cancel, content?}`. This module is the
 * single source of truth for that contract on the TS side: payload validation (which doubles as
 * the fallback-tier dispatch check), the result envelope, and part-state derivation. Pinned by
 * golden fixtures shared with the Python emitter tests (`tests/fixtures/elicitation_*.json`).
 *
 * Security: the validator REFUSES secret-shaped fields (see `SECRET_FIELD_PATTERN`) — secrets
 * ride platform-owned flows whose data path bypasses the chat wire, never schema-driven forms.
 * Full design: docs/design/agent-chat-interaction-kinds/decisions.md
 */

/** Wire value for `render.kind` on elicitation interactions (REQUIRED on emissions). */
export const ELICITATION_RENDER_KIND = "elicitation"

/** Property names/titles that must never appear in a payload-driven form. */
export const SECRET_FIELD_PATTERN =
    /(pass(word|wd)|token|api[_-]?key|apikey|secret|credential|private[_-]?key|access[_-]?key)/i

/** Primitive types the flat dialect accepts on a top-level property. */
const FIELD_TYPES = new Set(["string", "number", "integer", "boolean"])

/** `format` values the renderer maps to dedicated controls; unknown formats fall back to text. */
export const KNOWN_STRING_FORMATS = new Set(["date", "date-time", "email", "uri", "multiline"])

/** Natural aliases an author (often an LLM) emits for a known format. */
const STRING_FORMAT_ALIASES: Record<string, string> = {
    textarea: "multiline",
    "multi-line": "multiline",
    multi_line: "multiline",
    longtext: "multiline",
    "long-text": "multiline",
    long_text: "multiline",
    datetime: "date-time",
    url: "uri",
}

/** Resolve a schema `format` to a renderer-known format (aliases → canonical), or undefined. */
export function normalizeStringFormat(format: unknown): string | undefined {
    if (typeof format !== "string") return undefined
    const lower = format.trim().toLowerCase()
    const canonical = STRING_FORMAT_ALIASES[lower] ?? lower
    return KNOWN_STRING_FORMATS.has(canonical) ? canonical : undefined
}

export interface ElicitationFieldSchema {
    type: "string" | "number" | "integer" | "boolean"
    title?: string
    description?: string
    enum?: string[]
    format?: string
    /** Proposed value prefilling the field, so the user can accept the whole form in one click. */
    default?: string | number | boolean
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    [key: `x-ag-${string}`]: unknown
}

export interface ElicitationRequestPayload {
    message: string
    requestedSchema: {
        type: "object"
        properties: Record<string, ElicitationFieldSchema>
        required?: string[]
    }
}

export type ElicitationAction = "accept" | "decline" | "cancel"

/**
 * The settling tool result. User actions ALWAYS ride this structured shape (`output` channel);
 * `errorText` is reserved for degradation so emitters can tell "user declined" from "client
 * couldn't render". `humanFriendlyMessage` is the envelope-sourced chip copy — a complete
 * sentence that reads correctly on replay with no context.
 */
export interface ElicitationResult {
    action: ElicitationAction
    content?: Record<string, unknown>
    humanFriendlyMessage?: string
}

export type ElicitationParseResult =
    | {ok: true; payload: ElicitationRequestPayload}
    | {ok: false; reason: string}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Validate an incoming client-tool input as an elicitation payload (tolerant reader: unknown
 * extra keys are ignored; the hard rules below are the dialect). Failure reasons are stable
 * strings surfaced on the degradation card and asserted by the golden fixtures.
 */
export function parseElicitationPayload(input: unknown): ElicitationParseResult {
    if (!isRecord(input)) return {ok: false, reason: "payload is not an object"}
    const {message, requestedSchema} = input as Partial<ElicitationRequestPayload>

    if (typeof message !== "string" || message.trim() === "")
        return {ok: false, reason: "missing message"}
    if (!isRecord(requestedSchema)) return {ok: false, reason: "missing requestedSchema"}
    if (requestedSchema.type !== "object")
        return {ok: false, reason: 'requestedSchema.type must be "object"'}
    if (
        !isRecord(requestedSchema.properties) ||
        Object.keys(requestedSchema.properties).length === 0
    )
        return {ok: false, reason: "requestedSchema.properties is empty"}

    for (const [name, prop] of Object.entries(requestedSchema.properties)) {
        if (!isRecord(prop)) return {ok: false, reason: `property "${name}" is not an object`}
        const type = prop.type
        if (typeof type !== "string" || !FIELD_TYPES.has(type))
            return {ok: false, reason: `property "${name}" has unsupported type "${String(type)}"`}
        if ("properties" in prop || "items" in prop)
            return {ok: false, reason: `property "${name}" is nested — flat dialect only`}
        if (prop.enum !== undefined) {
            if (!Array.isArray(prop.enum) || prop.enum.some((v) => typeof v !== "string"))
                return {ok: false, reason: `property "${name}" enum must be strings`}
        }
        if (
            prop.default !== undefined &&
            !["string", "number", "boolean"].includes(typeof prop.default)
        )
            return {ok: false, reason: `property "${name}" default must be a primitive`}
        const title = typeof prop.title === "string" ? prop.title : ""
        if (SECRET_FIELD_PATTERN.test(name) || SECRET_FIELD_PATTERN.test(title))
            return {ok: false, reason: `property "${name}" is secret-shaped — use a connect flow`}
    }

    const required = requestedSchema.required
    if (required !== undefined) {
        if (!Array.isArray(required) || required.some((r) => typeof r !== "string"))
            return {ok: false, reason: "requestedSchema.required must be a string array"}
        const names = new Set(Object.keys(requestedSchema.properties))
        const unknown = required.find((r) => !names.has(r))
        if (unknown) return {ok: false, reason: `required field "${unknown}" is not a property`}
    }

    // Canonicalize format hints once at the boundary so the renderer and the serializer never
    // diverge (aliases like "datetime" → "date-time"); unknown formats are dropped.
    const properties = Object.fromEntries(
        Object.entries(requestedSchema.properties).map(([name, prop]) => {
            const field = {...(prop as ElicitationFieldSchema)}
            const canonical = normalizeStringFormat(field.format)
            if (canonical) field.format = canonical
            else delete field.format
            return [name, field]
        }),
    ) as Record<string, ElicitationFieldSchema>

    const requested = requestedSchema as ElicitationRequestPayload["requestedSchema"]
    const payload: ElicitationRequestPayload = {
        message,
        requestedSchema: {...requested, properties},
    }
    return {ok: true, payload}
}

/** Build the accept result. `content` must already be validated form values. */
export function buildAcceptResult(
    content: Record<string, unknown>,
    humanFriendlyMessage?: string,
): ElicitationResult {
    return humanFriendlyMessage
        ? {action: "accept", content, humanFriendlyMessage}
        : {action: "accept", content}
}

export function buildDeclineResult(humanFriendlyMessage?: string): ElicitationResult {
    return humanFriendlyMessage ? {action: "decline", humanFriendlyMessage} : {action: "decline"}
}

export function buildCancelResult(humanFriendlyMessage?: string): ElicitationResult {
    return humanFriendlyMessage ? {action: "cancel", humanFriendlyMessage} : {action: "cancel"}
}

/**
 * Degradation errorText, pinned shape (golden fixtures): emitters parse the prefix to tell
 * client-side degradation from a user decline (which is a structured `output`, never an error).
 */
export function buildDegradationErrorText(reason: string): string {
    return `elicitation: unsupported payload — ${reason}`
}

export type ElicitationPartState = "pending" | "submitted" | "declined" | "cancelled" | "degraded"

/**
 * Derive the replayable card state from an AI SDK tool part. Mirrors the ClientToolPart settle
 * semantics: `output-error`/`errorText` is degradation only; user actions land in `output`.
 * An output with no recognizable action replays as submitted (tolerant reader).
 */
export function deriveElicitationPartState(part: {
    state?: string
    output?: unknown
    errorText?: string
}): ElicitationPartState {
    if (part.state === "output-error" || typeof part.errorText === "string") return "degraded"
    if (part.state !== "output-available") return "pending"
    const action = isRecord(part.output) ? part.output.action : undefined
    if (action === "decline") return "declined"
    if (action === "cancel") return "cancelled"
    return "submitted"
}

/**
 * Degradation retry cap: true when an earlier part in the turn already auto-settled as an
 * elicitation degradation. The widget then PARKS the part (visible notice, no auto-settle)
 * instead of feeding the settle→resume→re-emit token loop.
 */
export function hasPriorElicitationDegradation(
    parts: readonly {state?: string; errorText?: string}[] | undefined,
): boolean {
    return (parts ?? []).some(
        (part) =>
            typeof part?.errorText === "string" &&
            part.errorText.startsWith("elicitation: unsupported payload"),
    )
}

const isDateLike = (value: unknown): value is {toISOString: () => string} =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as {toISOString?: unknown}).toISOString === "function"

/**
 * Serialize accepted form values against the payload schema: antd date pickers yield dayjs
 * objects, and the wire is pinned to ISO 8601 (`YYYY-MM-DD` for `date`, full ISO for
 * `date-time`) by the golden fixtures. Non-date values pass through untouched.
 */
export function serializeElicitationContent(
    payload: ElicitationRequestPayload,
    values: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(values)) {
        if (value === undefined) continue
        const format = payload.requestedSchema.properties[name]?.format
        if ((format === "date" || format === "date-time") && isDateLike(value)) {
            out[name] = format === "date" ? value.toISOString().slice(0, 10) : value.toISOString()
        } else {
            out[name] = value
        }
    }
    return out
}
