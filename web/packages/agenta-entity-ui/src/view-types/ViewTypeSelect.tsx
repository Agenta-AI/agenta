/**
 * ViewTypeSelect — the dropdown that sits in each field header. Lets the
 * user switch render mode (text/markdown/chat/form/json/yaml) for a
 * single typed value.
 *
 * Trigger: text button reading the current mode (e.g. `String ↕`, `Form ↕`)
 * with a two-way caret. The mode name speaks for itself — no "View as"
 * prefix.
 *
 * Menu: plain flat list of options — no group header, no per-option hint
 * pills. Matches the visual weight of the other small dropdowns in the
 * playground.
 */

import {useMemo} from "react"

import {CaretUpDown} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import type {MenuProps} from "antd"

import type {ViewOption, ViewType} from "./viewTypes"

interface ViewTypeSelectProps {
    value: ViewType
    options: ViewOption[]
    onChange: (value: ViewType) => void
    disabled?: boolean
}

// Visible labels for each ViewType. The underlying `text` value is shown to
// the user as "String" — covers strings, numbers, booleans, and nulls
// rendered as their primitive text form. The internal value name stays
// `"text"` to avoid an invasive rename across the codebase.
const VIEW_LABELS: Record<ViewType, string> = {
    text: "String",
    markdown: "Markdown",
    chat: "Chat",
    form: "Form",
    json: "JSON",
    yaml: "YAML",
}

export function ViewTypeSelect({value, options, onChange, disabled}: ViewTypeSelectProps) {
    const items: MenuProps["items"] = useMemo(
        () =>
            options.map((opt) => ({
                key: opt.value,
                label: opt.label || VIEW_LABELS[opt.value],
                onClick: () => onChange(opt.value),
            })),
        [options, onChange],
    )

    return (
        <Dropdown
            menu={{items, selectedKeys: [value]}}
            trigger={["click"]}
            disabled={disabled}
            placement="bottomRight"
        >
            <Button type="text" size="small" disabled={disabled} style={styles.trigger}>
                <span style={styles.triggerValue}>{VIEW_LABELS[value]}</span>
                <CaretUpDown size={12} style={styles.triggerCaret} />
            </Button>
        </Dropdown>
    )
}

const styles = {
    trigger: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
        height: 24,
        borderRadius: 4,
        fontSize: 12,
    },
    // Theme token so the trigger label stays readable in dark mode. The
    // previous hardcoded `#051729` (Agenta navy) inverts via the codemod
    // when used as a CSS variable but NOT when set inline, so dark mode
    // rendered the trigger as dark-navy-on-dark — invisible (Kaosiso QA
    // 2026-06-02).
    triggerValue: {color: "var(--ag-colorText)", fontWeight: 600},
    triggerCaret: {marginTop: 1, opacity: 0.65},
}

export default ViewTypeSelect
