import {memo, type ComponentType, type ReactNode} from "react"

import {ArrowsInLineVertical, Copy, Funnel} from "@phosphor-icons/react"

import type {ViewMode} from "../utils/getViewOptions"

import {ViewModeDropdown} from "./ViewModeDropdown"

export type RootViewMode = ViewMode

export interface DrillInRootToolbarProps {
    /** Testcase or variable-set label shown on the left */
    label: string
    /** Currently selected view mode */
    viewMode: RootViewMode
    /** Called when the user picks a new mode from the dropdown */
    onViewModeChange: (mode: RootViewMode) => void
    /** Called when the collapse-all button is clicked */
    onCollapseAll?: () => void
    /** Called when the filter button is clicked */
    onFilter?: () => void
    /** Called when the copy button is clicked */
    onCopy?: () => void
    /**
     * When false (default), "Form" is absent from the view-mode dropdown.
     * Flip to true in the DrillInUIProvider once the form renderer is stable.
     */
    enableFormView?: boolean
    /** Tooltip component. Falls back to no-op. */
    Tooltip?: ComponentType<{title?: string; children: ReactNode}>
    /** Button component. Falls back to native button. */
    Button?: ComponentType<{
        type?: "text"
        size?: "small"
        icon?: ReactNode
        onClick?: () => void
        "aria-label"?: string
    }>
}

const BASE_OPTIONS: {value: RootViewMode; label: string}[] = [
    {value: "text", label: "Text"},
    {value: "markdown", label: "Markdown"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

const FORM_OPTION: {value: RootViewMode; label: string} = {value: "form", label: "Form"}

function NoTooltip({children}: {title?: string; children: ReactNode}) {
    return <>{children}</>
}

function NativeButton({
    icon,
    onClick,
    "aria-label": ariaLabel,
}: {
    type?: "text"
    size?: "small"
    icon?: ReactNode
    onClick?: () => void
    "aria-label"?: string
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                padding: 0,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                borderRadius: 4,
                color: "rgba(5,23,41,0.45)",
            }}
        >
            {icon}
        </button>
    )
}

export const DrillInRootToolbar = memo(function DrillInRootToolbar({
    label,
    viewMode,
    onViewModeChange,
    onCollapseAll,
    onFilter,
    onCopy,
    enableFormView = false,
    Tooltip: TooltipComp = NoTooltip,
    Button: ButtonComp = NativeButton,
}: DrillInRootToolbarProps) {
    const options = enableFormView ? [FORM_OPTION, ...BASE_OPTIONS] : BASE_OPTIONS

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 16px",
                borderBottom: "1px solid rgba(5,23,41,0.06)",
                background: "#fafafa",
                gap: 8,
                minHeight: 36,
            }}
        >
            <span
                style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#051729",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                }}
            >
                {label}
            </span>

            <div style={{display: "flex", alignItems: "center", gap: 4, flexShrink: 0}}>
                {onFilter && (
                    <TooltipComp title="Filter fields">
                        <ButtonComp
                            type="text"
                            size="small"
                            icon={<Funnel size={12} />}
                            onClick={onFilter}
                            aria-label="Filter fields"
                        />
                    </TooltipComp>
                )}
                {onCollapseAll && (
                    <TooltipComp title="Collapse all">
                        <ButtonComp
                            type="text"
                            size="small"
                            icon={<ArrowsInLineVertical size={12} />}
                            onClick={onCollapseAll}
                            aria-label="Collapse all fields"
                        />
                    </TooltipComp>
                )}
                <ViewModeDropdown value={viewMode} options={options} onChange={onViewModeChange} />
                {onCopy && (
                    <TooltipComp title="Copy testcase">
                        <ButtonComp
                            type="text"
                            size="small"
                            icon={<Copy size={12} />}
                            onClick={onCopy}
                            aria-label="Copy testcase"
                        />
                    </TooltipComp>
                )}
            </div>
        </div>
    )
})
