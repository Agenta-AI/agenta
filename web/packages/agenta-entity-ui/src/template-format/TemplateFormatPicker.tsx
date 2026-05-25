/**
 * TemplateFormatPicker — small dropdown for choosing how a prompt template
 * renders (Mustache / Jinja2 / [Curly] / [F-string]).
 *
 * Used by the playground prompt-config surface (Step 5/6 of the playground
 * mustache + input UX branch). The picker is *presentational*: it doesn't
 * know about variant entities or molecules. The wiring layer (Step 6, in
 * OSS) wires it up to the active prompt's `template_format` field.
 *
 * Value handling:
 *   - `value` is a free string so prompts storing legacy formats (`curly`,
 *     `fstring`) keep their selection visible; never silently coerced.
 *   - Options are computed by `buildTemplateFormatOptions(value)` — the
 *     vendored helper alongside this file. See `templateFormatOptions.ts`
 *     for the contract and the vendoring note.
 *
 * Visual style:
 *   - Compact antd `Select`, sized to fit alongside a label.
 *   - "default" / "legacy" hints render as a small right-aligned chip.
 */

import {useMemo} from "react"

import {Select, Tag} from "antd"

import {
    buildTemplateFormatOptions,
    DEFAULT_TEMPLATE_FORMAT,
    type TemplateFormatOption,
} from "./templateFormatOptions"

export interface TemplateFormatPickerProps {
    /** Current template_format from the prompt config. `null` / `undefined`
     *  → falls back to `DEFAULT_TEMPLATE_FORMAT` (mustache). */
    value?: string | null
    onChange: (next: string) => void
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
    const options = useMemo(() => buildTemplateFormatOptions(value), [value])
    const resolvedValue = value ?? DEFAULT_TEMPLATE_FORMAT

    return (
        <Select<string>
            size="small"
            value={resolvedValue}
            disabled={disabled}
            onChange={onChange}
            className={className}
            style={{minWidth: 120}}
            popupMatchSelectWidth={false}
            optionLabelProp="label"
            options={options.map((opt) => ({
                value: opt.value,
                label: opt.label,
            }))}
            optionRender={(option) => {
                const opt = options.find((o) => o.value === option.value) as
                    | TemplateFormatOption
                    | undefined
                return (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                        }}
                    >
                        <span>{opt?.label ?? String(option.label)}</span>
                        {opt?.hint ? (
                            <Tag
                                color={opt.hint === "legacy" ? "default" : "blue"}
                                style={{
                                    fontSize: 10,
                                    marginInlineEnd: 0,
                                    fontFamily:
                                        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                }}
                            >
                                {opt.hint}
                            </Tag>
                        ) : null}
                    </div>
                )
            }}
        />
    )
}

export default TemplateFormatPicker
