/**
 * Pure helpers for the subscription drawer: reference reading, selector labelling and the
 * event-payload normalization that feeds the mapping preview.
 */
import type {TriggerConnection} from "@agenta/entities/gatewayTrigger"

export function connectionName(conn: TriggerConnection | undefined): string {
    return conn?.name || conn?.slug || conn?.integration_key || ""
}

/**
 * The Name placeholder, and what gets saved when the field is left empty — "Issue opened —
 * Bug report". Without it an unnamed trigger renders as its raw id in the triggers table.
 */
export function suggestSubscriptionName(
    eventLabel?: string | null,
    agentName?: string | null,
): string {
    const event = eventLabel?.trim() || ""
    const agent = agentName?.trim() || ""
    if (event && agent) return `${event} — ${agent}`
    return event || agent || ""
}

// Friendly label for a selector pill/field row: "$.event.attributes.message_user" → "Message user".
export function selectorLabel(selector: string): string {
    if (selector === "$" || selector === "$.") return "Full event"
    const tail = selector.split(".").pop() || selector
    const words = tail.replace(/_+/g, " ").trim()
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : selector
}

// Mirror of the backend dispatcher `_build_context`: the raw provider payload becomes
// `event.attributes`, alongside the synthetic event fields. Token selectors preview
// against this shape.
export function buildPreviewContext(
    payload: Record<string, unknown> | null,
): Record<string, unknown> {
    return {
        event: {
            event_id: "evt_…",
            event_type: "…",
            timestamp: "…",
            created_at: "…",
            attributes: payload ?? {},
        },
    }
}

// The catalog ships the event `payload` as a JSON Schema (properties/required/type), not an
// instance. Detect that so we can derive an example from its `properties` instead of listing
// the schema's own meta-keys.
function isJsonSchema(payload: Record<string, unknown>): boolean {
    return (
        payload.type === "object" && !!payload.properties && typeof payload.properties === "object"
    )
}

// Build a representative instance from a JSON Schema node: real `example`/`examples`/`default`
// when present, else recurse objects/arrays, else a typed placeholder (e.g. "<string>").
function schemaToExample(node: unknown): unknown {
    if (!node || typeof node !== "object") return node
    const n = node as Record<string, unknown>
    if (n.example !== undefined) return n.example
    if (Array.isArray(n.examples) && n.examples.length) return n.examples[0]
    if (n.default !== undefined) return n.default
    if (n.properties && typeof n.properties === "object") {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
            out[k] = schemaToExample(v)
        }
        return out
    }
    if (n.type === "array") return [schemaToExample(n.items ?? {})]
    const t = Array.isArray(n.type) ? n.type[0] : n.type
    return t ? `<${String(t)}>` : "<value>"
}

// Normalize a catalog payload (schema OR instance) into an example instance for the mapper.
export function eventExampleFromPayload(
    payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!payload) return null
    if (isJsonSchema(payload)) return schemaToExample(payload) as Record<string, unknown>
    return payload
}
