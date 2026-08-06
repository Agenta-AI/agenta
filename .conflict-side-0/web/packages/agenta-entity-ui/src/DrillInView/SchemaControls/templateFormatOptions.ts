export type TemplateFormat = "mustache" | "curly" | "fstring" | "jinja2"

// Template format option labels.
//
// ``mustache`` and ``jinja2`` are the formats offered to new prompts. ``curly``
// and ``fstring`` are LEGACY: they are hidden from the picker so new prompts
// cannot select them, but a prompt that already stores one of them keeps it
// visible and selectable (see ``buildTemplateFormatOptions``). Hiding the
// legacy formats was lost in a past regression — ``buildTemplateFormatOptions``
// and its unit test pin it so it does not regress again.
export const TEMPLATE_FORMAT_LABELS: Record<TemplateFormat, string> = {
    mustache: "Prompt Syntax: Mustache",
    jinja2: "Prompt Syntax: Jinja2",
    curly: "Prompt Syntax: Curly",
    fstring: "Prompt Syntax: F-string",
}

export const OFFERED_TEMPLATE_FORMATS: TemplateFormat[] = ["mustache", "jinja2"]

/**
 * Build the template-format dropdown options.
 *
 * New prompts may only pick ``mustache`` or ``jinja2``. The legacy ``curly`` and
 * ``fstring`` formats are never offered as new choices, but BOTH the currently
 * selected format AND the originally-stored format are always included so:
 *   1. An existing prompt that stores a legacy format renders without silent
 *      coercion (the `current` inclusion).
 *   2. A user who switches AWAY from a legacy format mid-session can still
 *      switch back to it in the same session (the `original` inclusion).
 *
 * Without the `original` inclusion, switching `curly → mustache` once would
 * drop `curly` from the dropdown — Kaosiso reported this on 2026-06-01:
 * "the curly option is removed from the dropdown ... users cannot switch
 * back to curly". `original` is the format the picker was first mounted
 * with; it stays selectable for the lifetime of the picker even if the
 * user has navigated away to a non-legacy choice.
 */
export function buildTemplateFormatOptions(
    current: TemplateFormat,
    original?: TemplateFormat,
): {label: string; value: TemplateFormat}[] {
    const values: TemplateFormat[] = [...OFFERED_TEMPLATE_FORMATS]
    if (!values.includes(current)) {
        values.push(current)
    }
    if (original && !values.includes(original)) {
        values.push(original)
    }
    return values.map((value) => ({label: TEMPLATE_FORMAT_LABELS[value], value}))
}
