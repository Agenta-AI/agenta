/**
 * ViewTypeSelect — the "View as …" dropdown that sits in each field
 * header. Lets the user switch render mode (text/markdown/chat/form/json/yaml)
 * for a single typed value.
 *
 * Trigger: text button reading "View as {Current Mode} ▾" (the "View as"
 * prefix is intentional — it disambiguates the dropdown's purpose from the
 * plain mode pickers used elsewhere).
 *
 * Menu: a plain flat list of options — no group header, no per-option hint
 * pills. Matches the visual weight of the other small dropdowns in the
 * playground (the prompt config view-mode picker is the reference).
 */

import {useMemo} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import type {MenuProps} from "antd"

import type {ViewOption, ViewType} from "./viewTypes"

interface ViewTypeSelectProps {
    value: ViewType
    options: ViewOption[]
    onChange: (value: ViewType) => void
    disabled?: boolean
}

const VIEW_LABELS: Record<ViewType, string> = {
    text: "Text",
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
                <span style={styles.triggerLabel}>
                    View as <span style={styles.triggerValue}>{VIEW_LABELS[value]}</span>
                </span>
                <CaretDown size={12} style={styles.triggerCaret} />
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
        color: "#051729",
    },
    triggerLabel: {color: "rgba(5, 23, 41, 0.55)"},
    triggerValue: {color: "#051729", fontWeight: 600},
    triggerCaret: {marginTop: 1, opacity: 0.65},
}

export default ViewTypeSelect
