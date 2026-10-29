/**
 * Field tags for an event automation's instruction, built from the catalog payload schema.
 *
 * Each tag is one event field the user can drop into the instruction as a pill. The pill is
 * stored as a selector into the dispatcher's event context: `$.event.attributes.<key>`.
 */
import {humanizeActionKey} from "@agenta/shared/utils"

import {selectorPath} from "./selectorPreview"

const EVENT_ATTRIBUTES = "$.event.attributes"

export interface EventField {
    key: string
    selector: string
    label: string
    /** The provider's own description, or null when the schema has none. */
    description: string | null
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

/** A pill's label: the field path made readable, the same label its tag shows. */
export function selectorLabel(selector: string): string {
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

function field(path: string[], property: Record<string, unknown>): EventField {
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
 * One field per property of `payload.properties`, in schema order. An object with its own
 * `properties` gives one field per child, labelled with the object's name first; deeper
 * objects and arrays are one field.
 */
export function eventFieldsFromSchema(payloadSchema: unknown): EventField[] {
    return propertiesOf(payloadSchema).flatMap(([key, property]) => {
        const children = property.type === "object" ? propertiesOf(property) : []
        if (!children.length) return [field([key], property)]
        return children.map(([child, value]) => field([key, child], value))
    })
}
