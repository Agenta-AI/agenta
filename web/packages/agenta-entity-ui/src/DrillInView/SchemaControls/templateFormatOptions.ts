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
 * ``fstring`` formats are never offered as new choices, but the currently
 * selected format is always included so an existing prompt that stores a legacy
 * format still renders correctly and is not silently coerced.
 */
export function buildTemplateFormatOptions(
    current: TemplateFormat,
): {label: string; value: TemplateFormat}[] {
    const values: TemplateFormat[] = [...OFFERED_TEMPLATE_FORMATS]
    if (!values.includes(current)) {
        values.push(current)
    }
    return values.map((value) => ({label: TEMPLATE_FORMAT_LABELS[value], value}))
}
