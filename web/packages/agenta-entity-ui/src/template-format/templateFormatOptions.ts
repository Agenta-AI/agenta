/**
 * Template-format picker options for the playground (and any other surface
 * that lets a user choose how a prompt template renders).
 *
 * The contract mirrors what WP-B3 (#4393) ships under
 * `agenta-entity-ui/src/DrillInView/SchemaControls/templateFormatOptions.ts`.
 * Vendored here so the playground picker (Step 5 of the playground mustache
 * branch) can ship before #4393 merges.
 *
 * VENDORING NOTE — when #4393 lands:
 *   - Diff this file against #4393's version.
 *   - Adopt whichever is canonical (likely #4393's, since it'll have shipped
 *     the matching `template_format` type widening across the editor /
 *     chat-message / schema-control surfaces).
 *   - Update consumers (TemplateFormatPicker, downstream importers) to point
 *     at the canonical helper.
 *   - Delete this file.
 *
 * Behavior (matches the design doc + #4393 web-handoff):
 *   - New / mustache / jinja2 prompts        → options = ["mustache", "jinja2"]
 *   - Prompt already storing `curly`         → ["mustache", "jinja2", "curly"]
 *   - Prompt already storing `fstring`       → ["mustache", "jinja2", "fstring"]
 *   - Never coerce: the stored format stays selectable for the prompt that
 *     already uses it; legacy formats are not offered to other prompts.
 */

/** Formats actively offered to NEW prompts. */
export const OFFERED_TEMPLATE_FORMATS = ["mustache", "jinja2"] as const

/** Formats kept around for backwards compatibility (hidden unless already
 *  selected on a particular prompt). */
export const LEGACY_TEMPLATE_FORMATS = ["curly", "fstring"] as const

/** Every recognized format (offered + legacy). */
export const ALL_TEMPLATE_FORMATS = [
    ...OFFERED_TEMPLATE_FORMATS,
    ...LEGACY_TEMPLATE_FORMATS,
] as const

export type TemplateFormatValue = (typeof ALL_TEMPLATE_FORMATS)[number]

export interface TemplateFormatOption {
    value: string
    label: string
    /** Tiny right-aligned hint (e.g. "default", "legacy"). */
    hint?: string
}

const FORMAT_LABEL: Record<string, string> = {
    mustache: "Mustache",
    jinja2: "Jinja2",
    curly: "Curly",
    fstring: "F-string",
}

const HINT_BY_OFFERED: Record<string, string | undefined> = {
    mustache: "default",
}

/**
 * Compute the dropdown options for the template-format picker.
 *
 * @param currentFormat The format currently stored on the prompt (or null
 *   / undefined for a new prompt). When the current value is a legacy
 *   format, it is APPENDED to the offered set so the user keeps the
 *   ability to see and change it. Other prompts will never be offered
 *   the legacy formats.
 */
export function buildTemplateFormatOptions(
    currentFormat: string | null | undefined,
): TemplateFormatOption[] {
    const offered: TemplateFormatOption[] = OFFERED_TEMPLATE_FORMATS.map((value) => ({
        value,
        label: FORMAT_LABEL[value] ?? value,
        hint: HINT_BY_OFFERED[value],
    }))

    if (!currentFormat) return offered

    const isOffered = (OFFERED_TEMPLATE_FORMATS as readonly string[]).includes(currentFormat)
    if (isOffered) return offered

    const isLegacy = (LEGACY_TEMPLATE_FORMATS as readonly string[]).includes(currentFormat)
    if (isLegacy) {
        return [
            ...offered,
            {
                value: currentFormat,
                label: FORMAT_LABEL[currentFormat] ?? currentFormat,
                hint: "legacy",
            },
        ]
    }

    // Unknown format (defensive): keep it visible so the user can see and
    // change it. Don't coerce silently.
    return [
        ...offered,
        {
            value: currentFormat,
            label: currentFormat,
        },
    ]
}

/** Default format for a new prompt (no `currentFormat` stored). */
export const DEFAULT_TEMPLATE_FORMAT = "mustache"
