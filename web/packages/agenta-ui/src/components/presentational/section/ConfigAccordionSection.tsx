/**
 * ConfigAccordionSection
 *
 * A collapsible section used to compose accordion-style configuration panels — the
 * agent playground config panel today, and other config surfaces as the pattern rolls
 * out. The header shows an icon + title on the left and a collapsed-state summary +
 * chevron on the right; the body collapses smoothly via {@link HeightCollapse}.
 *
 * Sections can be **availability-gated**: pass `locked` (with an optional `lockedReason`)
 * when a capability is not supported in the current context (e.g. an MCP section locked
 * because the selected harness can't host MCP servers). A locked section can't be
 * expanded and renders a lock affordance instead of the chevron.
 *
 * Works controlled (`open` + `onOpenChange`) or uncontrolled (`defaultOpen`).
 *
 * @example
 * ```tsx
 * <ConfigAccordionSection
 *   icon={<Cpu />}
 *   title="Model & harness"
 *   summary="Claude Code · Claude Sonnet 4.5"
 *   defaultOpen
 * >
 *   <HarnessSelect />
 *   <ModelSelect />
 * </ConfigAccordionSection>
 * ```
 */
import {type ReactNode, useCallback, useState} from "react"

import {CaretDown, CaretRight, Lock} from "@phosphor-icons/react"
import {Tooltip, Typography} from "antd"

import {cn} from "../../../utils/styles"
import {HeightCollapse} from "../../HeightCollapse"

const {Text} = Typography

export interface ConfigAccordionSectionProps {
    /** Section title shown in the header. */
    title: ReactNode
    /** Leading icon shown before the title. */
    icon?: ReactNode
    /**
     * Collapsed-state preview shown on the right of the header (e.g.
     * "Claude Code · Sonnet 4.5", "3 tools"). Stays visible while expanded so the
     * header always reflects the current value.
     */
    summary?: ReactNode
    /** Header-right content rendered before the chevron (e.g. an enable toggle). */
    extra?: ReactNode
    /** Controlled open state. Provide together with `onOpenChange`. */
    open?: boolean
    /** Initial open state when uncontrolled. @default true */
    defaultOpen?: boolean
    /** Called when the user toggles the section. */
    onOpenChange?: (open: boolean) => void
    /** When true the section can't be expanded and shows a lock affordance. */
    locked?: boolean
    /** Explanation shown in a tooltip on the lock affordance. */
    lockedReason?: ReactNode
    /** Drop the bottom divider (e.g. for the last section in a panel). */
    noDivider?: boolean
    /**
     * When false the section stays open with no collapse affordance (used by the "cards"
     * layout). @default true
     */
    collapsible?: boolean
    /** Additional CSS class for the section wrapper. */
    className?: string
    /** Section body. */
    children?: ReactNode
}

/**
 * A single collapsible section for accordion-style config panels.
 */
export function ConfigAccordionSection({
    title,
    icon,
    summary,
    extra,
    open,
    defaultOpen = true,
    onOpenChange,
    collapsible = true,
    locked = false,
    lockedReason,
    noDivider = false,
    className,
    children,
}: ConfigAccordionSectionProps) {
    const isControlled = open !== undefined
    const [internalOpen, setInternalOpen] = useState(defaultOpen)
    // Non-collapsible sections (e.g. the "cards" layout) stay open; locked sections stay shut.
    const isOpen = !locked && (collapsible ? (isControlled ? open : internalOpen) : true)
    const canToggle = collapsible && !locked

    const toggle = useCallback(() => {
        if (!canToggle) return
        const next = !isOpen
        if (!isControlled) setInternalOpen(next)
        onOpenChange?.(next)
    }, [canToggle, isOpen, isControlled, onOpenChange])

    return (
        <div
            className={cn(
                "flex flex-col",
                !noDivider && "border-0 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)]",
                className,
            )}
        >
            <div
                role={canToggle ? "button" : undefined}
                aria-expanded={collapsible ? isOpen : undefined}
                aria-disabled={locked || undefined}
                tabIndex={canToggle ? 0 : undefined}
                onClick={canToggle ? toggle : undefined}
                onKeyDown={(e) => {
                    if (!canToggle) return
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        toggle()
                    }
                }}
                className={cn(
                    "flex items-center justify-between gap-2 py-3 select-none",
                    locked && "cursor-not-allowed opacity-60",
                    canToggle && "cursor-pointer",
                )}
            >
                <div className="flex min-w-0 items-center gap-2">
                    {icon ? (
                        <span className="flex shrink-0 items-center text-[var(--ag-c-586673,#586673)]">
                            {icon}
                        </span>
                    ) : null}
                    <Text className="truncate text-sm font-medium">{title}</Text>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {summary ? (
                        <Text
                            type="secondary"
                            className="max-w-[220px] truncate text-right text-xs"
                        >
                            {summary}
                        </Text>
                    ) : null}
                    {extra ? <span onClick={(e) => e.stopPropagation()}>{extra}</span> : null}
                    {locked ? (
                        <Tooltip title={lockedReason}>
                            <Lock size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                        </Tooltip>
                    ) : collapsible ? (
                        isOpen ? (
                            <CaretDown size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                        ) : (
                            <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                        )
                    ) : null}
                </div>
            </div>

            <HeightCollapse open={isOpen}>
                <div className="flex flex-col gap-3 pb-4">{children}</div>
            </HeightCollapse>
        </div>
    )
}
