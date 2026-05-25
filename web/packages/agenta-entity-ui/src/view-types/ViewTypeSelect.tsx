/**
 * ViewTypeSelect — the "View as ... ▾" dropdown that sits in each field
 * header. Lets the user switch render mode (text/markdown/chat/form/json/yaml)
 * for a single typed value.
 *
 * Visual style mirrors the role dropdown used inside the chat-message editor
 * (`@agenta/ui/chat-message → SimpleDropdownSelect`): a borderless text button
 * (label + caret) where the whole label-and-caret pair lights up on hover,
 * and a click opens an antd Dropdown menu beneath it. The menu has a small
 * "Select how to view" group label and exposes only the views that make
 * sense for the field's current type (computed by `getViewOptions`).
 *
 * Promoted from the design-mockups POC.
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
        () => [
            {
                key: "__lead",
                type: "group",
                label: <span style={styles.leadLabel}>Select how to view</span>,
                children: options.map((opt) => ({
                    key: opt.value,
                    label: (
                        <div style={styles.optionRow}>
                            <span style={styles.optionLabel}>{opt.label}</span>
                            {opt.hint ? <span style={styles.optionHint}>{opt.hint}</span> : null}
                        </div>
                    ),
                    onClick: () => onChange(opt.value),
                })),
            },
        ],
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
    leadLabel: {
        fontSize: 11,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    optionRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minWidth: 200,
    },
    optionLabel: {fontSize: 13, fontWeight: 500, color: "#051729"},
    optionHint: {fontSize: 11, color: "rgba(5, 23, 41, 0.55)"},
}

export default ViewTypeSelect
