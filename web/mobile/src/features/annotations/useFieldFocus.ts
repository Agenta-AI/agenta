import {useEffect, useRef, useState, type FocusEvent} from "react"

const FIELD = "[data-annotation-field]"

/**
 * What a field does with keys, read by the help line under the button: True and False keys, the
 * number keys of a choice, the arrows of a slider, or none (text, a number box, a dropdown).
 */
export type FieldKeyKind = "boolean" | "choice" | "slider" | "other"

export interface FocusedField {
    kind: FieldKeyKind
    /** The options of a choice, for "1 to N". */
    optionCount: number
    /** The arrow step of a slider. */
    step: number
}

/** Where a field takes the focus: a slider moves with the arrows, a text box and a number box
 * type, a dropdown opens; True and False and choice buttons take their keys on the field. */
const FOCUS_TARGETS = [
    "[role=slider]",
    "textarea",
    "input",
    "[role=combobox]",
    "[aria-haspopup=menu]",
]

export const focusField = (field: Element | null | undefined) => {
    if (!(field instanceof HTMLElement)) return
    const target =
        FOCUS_TARGETS.map((selector) => field.querySelector<HTMLElement>(selector)).find(Boolean) ??
        field
    target.focus()
}

/** After a pick the focus moves to the next field of the panel, in panel order. */
export const focusNextField = (from: Element | null) => {
    const field = from?.closest(FIELD)
    const root = field?.closest("[data-annotation-fields]")
    if (!field || !root) return
    const fields = Array.from(root.querySelectorAll(FIELD))
    focusField(fields[fields.indexOf(field) + 1])
}

/** The option a number key picks (1 is the first), else null. */
export const optionIndexForKey = (key: string, count: number): number | null => {
    const index = Number(key) - 1
    return Number.isInteger(index) && index >= 0 && index < count ? index : null
}

const readField = (target: EventTarget | null): FocusedField | null => {
    const field = target instanceof Element ? target.closest<HTMLElement>(FIELD) : null
    if (!field) return null
    return {
        kind: (field.dataset.fieldKind as FieldKeyKind | undefined) ?? "other",
        optionCount: Number(field.dataset.fieldOptions ?? 0),
        step: Number(field.dataset.fieldStep ?? 0),
    }
}

/**
 * The keys and focus of the queue panel. When an item opens its first field takes the focus; the
 * field in focus is the one the keys act on, and the help line reads its kind. `enabled` is false
 * for a reader who cannot annotate.
 */
export const useFieldFocus = (scenarioId: string, enabled: boolean) => {
    const ref = useRef<HTMLDivElement>(null)
    const [focused, setFocused] = useState<FocusedField | null>(null)
    const openedFor = useRef<string | null>(null)

    // The fields arrive after the evaluators load and the sections open, so wait for the first
    // one; then once per item.
    useEffect(() => {
        const container = ref.current
        if (!enabled || !scenarioId || !container || openedFor.current === scenarioId) return
        const focusFirst = () => {
            const first = container.querySelector(FIELD)
            if (!first) return false
            openedFor.current = scenarioId
            focusField(first)
            return true
        }
        if (focusFirst()) return
        const observer = new MutationObserver(() => {
            if (focusFirst()) observer.disconnect()
        })
        observer.observe(container, {childList: true, subtree: true})
        return () => observer.disconnect()
    }, [scenarioId, enabled])

    return {
        ref,
        focused: enabled ? focused : null,
        onFocus: (event: FocusEvent) => setFocused(readField(event.target)),
        onBlur: (event: FocusEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null)
        },
    }
}
