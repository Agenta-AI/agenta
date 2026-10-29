/**
 * Field cards for an event automation's instruction, built from the catalog payload schema.
 *
 * Each card is one event field the user can drop into the instruction as a pill. The pill is
 * stored as a selector into the dispatcher's event context: `$.event.attributes.<key>`.
 */
import {humanizeActionKey} from "@agenta/shared/utils"

import {selectorPath} from "./selectorPreview"

const EVENT_ATTRIBUTES = "$.event.attributes"

export interface EventFieldCard {
    key: string
    selector: string
    label: string
    /** The provider's own description, or null when the schema has none. */
    description: string | null
}

/** A run of cards. `label` is null for top-level fields, else the object's humanized name. */
export interface EventFieldGroup {
    key: string
    label: string | null
    cards: EventFieldCard[]
}

/** `["data", "createdBy"]` → "Data created by". Splits camelCase, then `humanizeActionKey`. */
export function fieldLabel(path: string[]): string {
    const words = path.map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2")).join("_")
    return humanizeActionKey(words)
}

function selectorStep(key: string): string {
    return /^[A-Za-z0-9_]+$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

/** The selector for an event field path, in bracket form where a key needs it. */
export function eventFieldSelector(path: string[]): string {
    return EVENT_ATTRIBUTES + path.map(selectorStep).join("")
}

/** A pill's label: the card's label when known, else the field path made readable. */
export function selectorLabel(selector: string, labels: Record<string, string>): string {
    const known = labels[selector]
    if (known) return known
    const path = selectorPath(selector)
    const prefix = ["event", "attributes"]
    if (!path) return selector
    const field = prefix.every((key, i) => path[i] === key) ? path.slice(2) : path
    return field.length ? fieldLabel(field) : selector
}

function propertiesOf(schema: unknown): [string, Record<string, unknown>][] {
    if (!schema || typeof schema !== "object") return []
    const properties = (schema as {properties?: unknown}).properties
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return []
    return Object.entries(properties as Record<string, unknown>).map(([key, value]) => [
        key,
        value && typeof value === "object" ? (value as Record<string, unknown>) : {},
    ])
}

function card(path: string[], property: Record<string, unknown>): EventFieldCard {
    const description =
        typeof property.description === "string" && property.description.trim()
            ? property.description.trim()
            : null
    return {
        key: path.join("."),
        selector: eventFieldSelector(path),
        label: fieldLabel(path),
        description,
    }
}

/**
 * One card per property of `payload.properties`, in schema order. An object with its own
 * `properties` is a group with one card per child; deeper objects and arrays are one card.
 */
export function eventFieldsFromSchema(payloadSchema: unknown): EventFieldGroup[] {
    const groups: EventFieldGroup[] = []
    for (const [key, property] of propertiesOf(payloadSchema)) {
        const children = property.type === "object" ? propertiesOf(property) : []
        if (children.length) {
            groups.push({
                key,
                label: fieldLabel([key]),
                cards: children.map(([child, value]) => card([key, child], value)),
            })
            continue
        }
        const last = groups[groups.length - 1]
        if (last && last.label === null) last.cards.push(card([key], property))
        else groups.push({key, label: null, cards: [card([key], property)]})
    }
    return groups
}

/** Selector → label for every card, the lookup the preview and the pills read. */
export function eventFieldLabels(groups: EventFieldGroup[]): Record<string, string> {
    return Object.fromEntries(
        groups.flatMap((group) => group.cards.map((c) => [c.selector, c.label] as const)),
    )
}
