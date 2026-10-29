/**
 * The text the agent gets for an event automation, built the way the dispatcher builds it.
 *
 * The preview and Run now both call `renderMessagePreview`, so Run now sends what the preview
 * shows. `formatEventText` and `eventValueText` mirror the backend (`core/triggers/utils.py`).
 */
import {selectorLabel} from "./eventFields"
import {splitTemplate} from "./eventMessageTemplate"
import {resolveSelectorPreview} from "./selectorPreview"

/** A resolved pill value as text: a string unchanged, null or absent empty, else compact JSON. */
export function eventValueText(value: unknown): string {
    if (typeof value === "string") return value
    if (value === null || value === undefined) return ""
    return JSON.stringify(value) ?? ""
}

/**
 * Whether the dispatcher adds the event to these stored inputs: only to a `messages` list, or
 * to no inputs at all, as `compose_event_inputs` does. Other shapes reach the agent unchanged.
 */
export function addsEventText(inputs: unknown): boolean {
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return false
    const obj = inputs as Record<string, unknown>
    return Array.isArray(obj.messages) || Object.keys(obj).length === 0
}

/** The event block added to the agent's message, starting with a blank line. */
export function formatEventText(eventType: unknown, attributes: unknown): string {
    const header =
        typeof eventType === "string" && eventType ? `Event data (${eventType}):` : "Event data:"
    return `\n\n${header}\n\`\`\`json\n${JSON.stringify(attributes, null, 2)}\n\`\`\``
}

/**
 * The whole message for a template. With an event, pills take its values; without one, each
 * pill reads as its label in square brackets. With `includeEvent` and event attributes, the
 * event block is added at the end.
 */
export function renderMessagePreview(
    template: string,
    event: Record<string, unknown> | null,
    includeEvent: boolean,
): string {
    const text = splitTemplate(template)
        .map((segment) => {
            if (segment.selector === undefined) return segment.literal ?? ""
            if (event) return eventValueText(resolveSelectorPreview(segment.selector, {event}))
            return `[${selectorLabel(segment.selector)}]`
        })
        .join("")
    if (!includeEvent || !event || event.attributes == null) return text
    const block = formatEventText(event.event_type, event.attributes)
    // An empty template saves as `{}`, where the dispatcher sends the block alone.
    return template.trim() ? text + block : block.replace(/^\n\n/, "")
}
