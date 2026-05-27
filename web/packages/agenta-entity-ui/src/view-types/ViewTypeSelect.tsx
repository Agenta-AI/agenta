/**
 * ViewTypeSelect — the "View as …" dropdown that sits in each field
 * header. Lets the user switch render mode (text/markdown/chat/form/json/yaml)
 * for a single typed value.
 *
 * Styled to match the rest of the playground's small dropdowns — the
 * `Form / JSON / YAML` view picker in `PlaygroundVariantConfig` is the visual
 * reference: a borderless `antd Select`, `size="small"`, no header label,
 * no per-option hint pills.
 */

import {useMemo} from "react"

import {Select} from "antd"

import type {ViewOption, ViewType} from "./viewTypes"

interface ViewTypeSelectProps {
    value: ViewType
    options: ViewOption[]
    onChange: (value: ViewType) => void
    disabled?: boolean
    /** Visual variant. Defaults to `"borderless"` — matches the prompt config
     *  view-mode dropdown. Use `"outlined"` for surfaces that want a chip
     *  border (rare). */
    variant?: "borderless" | "outlined"
    /** Optional className passed through to the Select root. */
    className?: string
}

const VIEW_LABELS: Record<ViewType, string> = {
    text: "Text",
    markdown: "Markdown",
    chat: "Chat",
    form: "Form",
    json: "JSON",
    yaml: "YAML",
}

export function ViewTypeSelect({
    value,
    options,
    onChange,
    disabled,
    variant = "borderless",
    className,
}: ViewTypeSelectProps) {
    const selectOptions = useMemo(
        () =>
            options.map((opt) => ({
                value: opt.value,
                label: opt.label || VIEW_LABELS[opt.value],
            })),
        [options],
    )

    return (
        <Select<ViewType>
            size="small"
            variant={variant}
            value={value}
            onChange={onChange}
            disabled={disabled}
            options={selectOptions}
            popupMatchSelectWidth={false}
            className={className}
            style={{minWidth: 90}}
        />
    )
}

export default ViewTypeSelect
