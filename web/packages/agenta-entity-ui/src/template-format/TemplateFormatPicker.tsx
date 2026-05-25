/**
 * TemplateFormatPicker — small dropdown for choosing how a prompt template
 * renders (Mustache / Jinja2 / [Curly] / [F-string]).
 *
 * Used by the playground prompt-config surface to let the user switch
 * `template_format`. Presentational only — the wiring layer feeds in the
 * current value and the change handler.
 *
 * Options + labels come from `buildTemplateFormatOptions` shipped by
 * WP-B3 (#4393) in `agenta-entity-ui/src/DrillInView/SchemaControls/`.
 * Contract:
 *   - New / mustache / jinja2 prompts → ["mustache", "jinja2"]
 *   - Prompts on curly → ["mustache", "jinja2", "curly"]
 *   - Prompts on fstring → ["mustache", "jinja2", "fstring"]
 *   - Labels: "Prompt Syntax: Mustache" / "Jinja2" / "Curly" / "F-string"
 *   - Never coerce: legacy formats stay selectable on prompts that already
 *     use them; never offered to other prompts.
 *
 * The drawer's `PromptSchemaControl` already consumes the same helper for
 * its inline picker — drawer and playground now share both options and
 * labels, so users get a consistent vocabulary across surfaces.
 */

import {useMemo} from "react"

import {Select} from "antd"

import {
    buildTemplateFormatOptions,
    type TemplateFormat,
} from "../DrillInView/SchemaControls/templateFormatOptions"

const DEFAULT_TEMPLATE_FORMAT: TemplateFormat = "mustache"

export interface TemplateFormatPickerProps {
    /** Current template_format from the prompt config. `null` / `undefined`
     *  → falls back to mustache (the WP-B3 default for new prompts). */
    value?: TemplateFormat | string | null
    onChange: (next: TemplateFormat) => void
    disabled?: boolean
    /** Optional className for layout overrides. */
    className?: string
}

export function TemplateFormatPicker({
    value,
    onChange,
    disabled,
    className,
}: TemplateFormatPickerProps) {
    const resolvedValue = (value as TemplateFormat | null | undefined) ?? DEFAULT_TEMPLATE_FORMAT
    const options = useMemo(() => buildTemplateFormatOptions(resolvedValue), [resolvedValue])

    return (
        <Select<TemplateFormat>
            size="small"
            value={resolvedValue as TemplateFormat}
            disabled={disabled}
            onChange={onChange}
            className={className}
            style={{minWidth: 180}}
            popupMatchSelectWidth={false}
            options={options}
        />
    )
}

export default TemplateFormatPicker
