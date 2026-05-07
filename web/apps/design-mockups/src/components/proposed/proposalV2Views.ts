/**
 * Shared view-type vocabulary + per-value option logic for the v2 proposal
 * drill-in.
 *
 * Available views:
 *   - text     | unquoted plain text (string only)
 *   - markdown | rendered markdown (string only)
 *   - chat     | chat-bubble rendering (messages-shaped arrays only)
 *   - form     | labelled-form rendering (objects)
 *   - json     | structured JSON in a code editor (always available)
 *   - yaml     | structured YAML in a code editor (always available)
 *
 * The top-level kind vocabulary (used in the field-section chip) is reduced
 * to {string, boolean, object, chat}. Numbers and nulls bucket as `string`
 * (single primitive value, rendered without quotes); arrays that aren't
 * messages bucket as `object` (structured data, rendered as JSON / Form).
 */

import type {ProposalV2ViewOption} from "./ProposalV2ViewTypeSelect"

export type ProposalV2ViewType = "text" | "markdown" | "chat" | "form" | "json" | "yaml"

/** Top-level kind shown in the field section chip. */
export type ProposalV2FieldKind = "string" | "boolean" | "object" | "chat"

/**
 * Whether the given top-level value should be treated as `chat` (an array
 * of role-tagged message objects). Tool-calls and tool-responses still count.
 */
export function isChatMessagesArray(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false
    const VALID_ROLES = new Set(["system", "user", "assistant", "tool", "developer", "function"])
    return value.every((item) => {
        if (!item || typeof item !== "object") return false
        const role = (item as Record<string, unknown>).role
        return typeof role === "string" && VALID_ROLES.has(role)
    })
}

/**
 * Reduce the runtime type to the 4-way top-level vocabulary:
 *   - chat    : array of role-tagged messages
 *   - object  : any structured value (object, plain array)
 *   - boolean : true / false
 *   - string  : everything else (string, number, null, undefined)
 *
 * Numbers and nulls are treated as primitive single values; the user told us
 * they don't appear standalone at the top level in real testcases, so we
 * don't bother giving them their own chip.
 */
export function detectFieldKind(value: unknown): ProposalV2FieldKind {
    if (isChatMessagesArray(value)) return "chat"
    if (typeof value === "boolean") return "boolean"
    if (Array.isArray(value)) return "object"
    if (value !== null && typeof value === "object") return "object"
    return "string"
}

/**
 * Inside a form / nested context we still want to know the precise runtime
 * type so the right widget renders (Switch for boolean, InputNumber for
 * number, Input.TextArea for string, etc.).
 */
export type ProposalV2NestedKind = "string" | "number" | "boolean" | "null" | "object" | "array"

export function detectNestedKind(value: unknown): ProposalV2NestedKind {
    if (value === null) return "null"
    if (typeof value === "string") return "string"
    if (typeof value === "number") return "number"
    if (typeof value === "boolean") return "boolean"
    if (Array.isArray(value)) return "array"
    if (typeof value === "object") return "object"
    return "string"
}

/**
 * Compute the dropdown options for a top-level field. Always includes
 * JSON + YAML. Adds Text/Markdown for strings, Chat for chat arrays, Form
 * for objects.
 */
export function getViewOptions(value: unknown): ProposalV2ViewOption[] {
    const kind = detectFieldKind(value)
    const opts: ProposalV2ViewOption[] = []

    if (kind === "string") {
        opts.push({value: "text", label: "Text", hint: "default"})
        opts.push({value: "markdown", label: "Markdown"})
    } else if (kind === "boolean") {
        opts.push({value: "text", label: "Text", hint: "default"})
    } else if (kind === "chat") {
        opts.push({value: "chat", label: "Chat", hint: "default"})
    } else if (kind === "object") {
        opts.push({value: "form", label: "Form", hint: "default"})
    }

    opts.push({value: "json", label: "JSON"})
    opts.push({value: "yaml", label: "YAML"})

    return opts
}

/** Default view for a top-level field. */
export function getDefaultViewForValue(value: unknown): ProposalV2ViewType {
    return getViewOptions(value)[0]?.value ?? "json"
}
