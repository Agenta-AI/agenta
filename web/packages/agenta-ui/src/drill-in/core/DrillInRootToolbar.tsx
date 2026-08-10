import {memo, useCallback, useRef, useState, type ComponentType, type ReactNode} from "react"

import {ArrowsInLineVertical, Check, Copy, Funnel} from "@phosphor-icons/react"

import {Button as AntdButton} from "../../components/ui/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../components/ui/tooltip"
import type {ViewMode} from "../utils/getViewOptions"

import {ViewModeDropdown} from "./ViewModeDropdown"

export type RootViewMode = ViewMode

export interface DrillInRootToolbarProps {
    /** Testcase or variable-set label shown on the left */
    label: string
    /** Optional content rendered between the label and toolbar controls. */
    headerSlot?: ReactNode
    /** Currently selected view mode */
    viewMode: RootViewMode
    /** Called when the user picks a new mode from the dropdown */
    onViewModeChange: (mode: RootViewMode) => void
    /** Called when the collapse-all button is clicked */
    onCollapseAll?: () => void
    /** Called when the filter button is clicked */
    onFilter?: () => void
    /** Called when the copy button is clicked */
    onCopy?: () => void | Promise<void>
    /**
     * When false (default), "Form" is absent from the view-mode dropdown.
     * Flip to true in the DrillInUIProvider once the form renderer is stable.
     */
    enableFormView?: boolean
    /** Tooltip component. Falls back to no-op. */
    Tooltip?: ComponentType<{title?: ReactNode; children: ReactNode}>
    /** Button component. Falls back to native button. */
    Button?: ComponentType<{
        variant?: "ghost"
        size?: "sm"
        icon?: ReactNode
        onClick?: () => void | Promise<void>
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

function DefaultTooltip({title, children}: {title?: ReactNode; children: ReactNode}) {
    if (title == null) return <>{children}</>
    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent>{title}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

function DefaultButton({
    variant,
    size,
    icon,
    onClick,
    "aria-label": ariaLabel,
}: {
    variant?: "ghost"
    size?: "sm"
    icon?: ReactNode
    onClick?: () => void | Promise<void>
    "aria-label"?: string
}) {
    return (
        <AntdButton variant={variant} size={size} onClick={onClick} aria-label={ariaLabel}>
            {icon}
        </AntdButton>
    )
}

export const DrillInRootToolbar = memo(function DrillInRootToolbar({
    label,
    headerSlot,
    viewMode,
    onViewModeChange,
    onCollapseAll,
    onFilter,
    onCopy,
    enableFormView = false,
    Tooltip: TooltipComp = DefaultTooltip,
    Button: ButtonComp = DefaultButton,
}: DrillInRootToolbarProps) {
    const options = enableFormView ? [FORM_OPTION, ...BASE_OPTIONS] : BASE_OPTIONS
    const [copied, setCopied] = useState(false)
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleCopy = useCallback(async () => {
        try {
            await onCopy?.()
            setCopied(true)
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
            copiedTimerRef.current = setTimeout(() => {
                setCopied(false)
                copiedTimerRef.current = null
            }, 2000)
        } catch {
            setCopied(false)
        }
    }, [onCopy])

    return (
        <div className="flex min-h-9 items-center justify-between gap-2 border-0 border-b border-solid border-[var(--ag-rgba-051729-06)] bg-[var(--ag-c-FAFAFA)] px-4 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--ag-c-051729)]">
                    {label}
                </span>
                {headerSlot ? <div className="min-w-0 overflow-hidden">{headerSlot}</div> : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {onFilter && (
                    <TooltipComp title="Filter fields">
                        <ButtonComp
                            variant="ghost"
                            size="sm"
                            icon={<Funnel size={14} />}
                            onClick={onFilter}
                            aria-label="Filter fields"
                        />
                    </TooltipComp>
                )}
                {onCollapseAll && (
                    <TooltipComp title="Collapse all">
                        <ButtonComp
                            variant="ghost"
                            size="sm"
                            icon={<ArrowsInLineVertical size={14} />}
                            onClick={onCollapseAll}
                            aria-label="Collapse all fields"
                        />
                    </TooltipComp>
                )}
                {onCopy && (
                    <TooltipComp title={copied ? "Copied" : "Copy"}>
                        <ButtonComp
                            variant="ghost"
                            size="sm"
                            icon={copied ? <Check size={14} /> : <Copy size={14} />}
                            onClick={handleCopy}
                            aria-label="Copy testcase"
                        />
                    </TooltipComp>
                )}
                <ViewModeDropdown value={viewMode} options={options} onChange={onViewModeChange} />
            </div>
        </div>
    )
})
