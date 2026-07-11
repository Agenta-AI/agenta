/**
 * Pure decision logic behind SchemaForm's enum controls (EnumWithOther, MultiEnumWithOther,
 * ChoiceCards) — extracted so the state transitions are unit-testable under the package's
 * node-environment vitest (same pattern as DrillInView's getEnumOptions).
 *
 * Load-bearing invariant: OTHER_ENUM_OPTION is a UI-only sentinel. It may appear as a Select
 * option value, but must NEVER survive into the form value (and from there into the accepted
 * elicitation `content`). Every transition here strips it.
 */
import type {FormFieldDescriptor} from "@agenta/shared/utils"

export const OTHER_ENUM_OPTION = "__ag_enum_other__"

/** ScheduleBuilderField has no empty state, so a cron field is born answered: the schedule the
 * builder displays must also be the seeded form value (WYSIWYG), never just a visual fallback. */
export const DEFAULT_CRON = "0 9 * * *"

/** Form seed for a cron field: the wire default when present, else the builder's display default. */
export const cronInitialValue = (fieldDefault: unknown): string =>
    typeof fieldDefault === "string" && fieldDefault ? fieldDefault : DEFAULT_CRON

/** A renderable option: bare enum values get {value}, oneOf options add label/description. */
export interface EnumOption {
    value: string
    label?: string
    description?: string
}

/** Merge enumValues with oneOf option metadata into the renderable option list. */
export const enumOptionsOf = (field: FormFieldDescriptor): EnumOption[] => {
    const metas = field.enumOptions ?? []
    const values = field.enumValues ?? metas.map((m) => m.value)
    return values.map((v) => metas.find((m) => m.value === v) ?? {value: v})
}

/** Any option description upgrades the control from a Select to choice cards. */
export const wantsChoiceCards = (field: FormFieldDescriptor): boolean =>
    !!field.enumOptions?.some((o) => o.description)

/** Select options with the trailing "Other…" escape-hatch entry. */
export const selectOptionsWithOther = (options: EnumOption[]) => [
    ...options.map((o) => ({value: o.value, label: o.label ?? o.value})),
    {value: OTHER_ENUM_OPTION, label: "Other…"},
]

/** True when the current value is set but not one of the options (default/replay off-menu).
 * An empty string counts as unset — it must not mount the control in Other-mode. */
export const isOffOptionsValue = (value: string | null | undefined, options: EnumOption[]) =>
    value != null && value !== "" && !options.some((o) => o.value === value)

/**
 * Multi-select Select onChange: strip the "Other…" sentinel (it opens the draft input, it is
 * not a value) and normalize empty → undefined so antd's required rule fires.
 */
export const splitOtherFromSelection = (
    next: string[],
): {values: string[] | undefined; openOther: boolean} => {
    const openOther = next.includes(OTHER_ENUM_OPTION)
    const values = next.filter((v) => v !== OTHER_ENUM_OPTION)
    return {values: values.length ? values : undefined, openOther}
}

/** Toggle a card: single-select replaces; multi toggles membership; empty → undefined. */
export const toggleCardSelection = (
    selected: string[],
    value: string,
    multiple: boolean,
): string | string[] | undefined => {
    if (!multiple) return value
    const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    return next.length ? next : undefined
}

/**
 * Commit an "Other…" draft: trim, drop empties and the sentinel itself, dedupe against the
 * current selection. Returns the unchanged selection when there is nothing to add.
 */
export const commitCustomValue = (
    selected: string[],
    draft: string | null | undefined,
    multiple: boolean,
): {changed: boolean; value: string | string[] | undefined} => {
    const custom = draft?.trim()
    if (!custom || custom === OTHER_ENUM_OPTION)
        return {
            changed: false,
            value: multiple ? (selected.length ? selected : undefined) : undefined,
        }
    if (!multiple) return {changed: true, value: custom}
    if (selected.includes(custom)) return {changed: false, value: selected}
    return {changed: true, value: [...selected, custom]}
}

/** The selection's off-options entries (custom values), preserving selection order. */
export const partitionCustomValues = (selected: string[], options: EnumOption[]): string[] =>
    selected.filter((v) => !options.some((o) => o.value === v))

/**
 * Single-select "Other" input typing: the value commits as the user types. Empty text clears
 * the value only when the input owned it (an off-options custom value) — a listed selection
 * must survive stray focus-and-clear in the input.
 */
export const typeCustomValue = (
    current: string | undefined,
    text: string,
    options: EnumOption[],
): {changed: boolean; value: string | undefined} => {
    if (text === OTHER_ENUM_OPTION) return {changed: false, value: current}
    if (!text.trim()) {
        if (isOffOptionsValue(current, options)) return {changed: true, value: undefined}
        return {changed: false, value: current}
    }
    return {changed: text !== current, value: text}
}

/** "1".."9" → index 0..8; anything else (incl. "0") → null. */
export const digitKeyIndex = (key: string): number | null =>
    /^[1-9]$/.test(key) ? Number(key) - 1 : null

/** Digit-key hit for a choice-card group: a listed option, the trailing Other tile, or nothing. */
export const resolveDigitSelection = (
    key: string,
    options: EnumOption[],
): {kind: "option"; value: string} | {kind: "other"} | null => {
    const i = digitKeyIndex(key)
    if (i === null) return null
    if (i < options.length) return {kind: "option", value: options[i].value}
    if (i === options.length) return {kind: "other"}
    return null
}
