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
import {Tooltip} from "antd"

import {cn} from "../../../utils/styles"
import {HeightCollapse} from "../../HeightCollapse"

export type SectionIndicatorTone = "draft" | "invalid" | "incomplete"

/**
 * The accent token for a section/item change indicator. Single source of truth for the
 * tone→token mapping, shared by the section header and the config panel's item indicators.
 */
export function sectionIndicatorColor(tone: SectionIndicatorTone): string {
    return tone === "invalid"
        ? "var(--ag-colorError)"
        : tone === "incomplete"
          ? "var(--ag-colorWarning)"
          : "var(--ag-colorInfo)"
}

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
    /**
     * When set, the header acts as a button that opens a drawer instead of expanding inline.
     * The body (`children`) is not rendered; a right chevron signals "opens" rather than "expands".
     */
    onOpen?: () => void
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
    /**
     * Header title size. `"default"` is 14px (config panel); `"compact"` is 12px for
     * dense surfaces that follow the 12px text convention (e.g. the trigger drawers).
     * @default "default"
     */
    size?: "default" | "compact"
    /**
     * Tints the leading icon to reflect the section's completion:
     * `"complete"` (filled — success), `"warning"` (required but empty), `"default"`
     * (neutral, e.g. an empty optional field). @default "default"
     */
    status?: "default" | "complete" | "warning"
    /**
     * Change/validation indicator for the leading icon: tints the icon, adds a status dot,
     * and (with `tooltip`) explains it on hover. Takes precedence over `status`. Used by the
     * agent config panel to flag sections with unsaved edits (`"draft"`), a blocking problem
     * (`"invalid"`), or an optional gap (`"incomplete"`).
     */
    indicator?: {tone: "draft" | "invalid" | "incomplete"; tooltip?: ReactNode}
    /** Only show `summary` while the section is collapsed. @default false (always). */
    summaryCollapsedOnly?: boolean
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
    onOpen,
    locked = false,
    lockedReason,
    noDivider = false,
    size = "default",
    status = "default",
    indicator,
    summaryCollapsedOnly = false,
    className,
    children,
}: ConfigAccordionSectionProps) {
    // Indicator (unsaved edits / validation) takes precedence over the completion `status`.
    const indicatorColor = indicator ? sectionIndicatorColor(indicator.tone) : null
    // The glyph gets a soft, desaturated tint; the full accent lives on the dot so it still reads.
    const iconColor = indicatorColor
        ? `color-mix(in srgb, ${indicatorColor} 45%, var(--ag-colorTextTertiary))`
        : status === "complete"
          ? "var(--ag-colorSuccess)"
          : status === "warning"
            ? "var(--ag-colorWarning)"
            : "var(--ag-c-586673,#586673)"
    const isControlled = open !== undefined
    const [internalOpen, setInternalOpen] = useState(defaultOpen)
    // A section can either open a drawer (onOpen) or expand inline (the accordion default).
    const opensDrawer = onOpen !== undefined && !locked
    // Non-collapsible sections (e.g. the "cards" layout) stay open; locked sections stay shut.
    const isOpen =
        !opensDrawer && !locked && (collapsible ? (isControlled ? open : internalOpen) : true)
    const canToggle = !opensDrawer && collapsible && !locked
    const headerActs = canToggle || opensDrawer

    const activate = useCallback(() => {
        if (opensDrawer) {
            onOpen?.()
            return
        }
        if (!canToggle) return
        const next = !isOpen
        if (!isControlled) setInternalOpen(next)
        onOpenChange?.(next)
    }, [opensDrawer, onOpen, canToggle, isOpen, isControlled, onOpenChange])

    return (
        <div
            className={cn(
                "flex flex-col",
                !noDivider && "border-0 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)]",
                className,
            )}
        >
            <div
                role={headerActs ? "button" : undefined}
                aria-expanded={opensDrawer ? undefined : collapsible ? isOpen : undefined}
                aria-disabled={locked || undefined}
                tabIndex={headerActs ? 0 : undefined}
                onClick={headerActs ? activate : undefined}
                onKeyDown={(e) => {
                    if (!headerActs) return
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        activate()
                    }
                }}
                className={cn(
                    "flex items-center justify-between gap-2 py-3 select-none",
                    locked && "cursor-not-allowed opacity-60",
                    headerActs && "cursor-pointer",
                )}
            >
                <div className="flex min-w-0 items-center gap-2">
                    {icon ? (
                        <Tooltip title={indicator?.tooltip}>
                            <span
                                className="relative flex shrink-0 items-center"
                                style={{color: iconColor}}
                            >
                                {icon}
                                {indicator ? (
                                    <span
                                        className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full border-[1.5px] border-[var(--ag-colorBgContainer)]"
                                        style={{background: indicatorColor ?? undefined}}
                                    />
                                ) : null}
                            </span>
                        </Tooltip>
                    ) : null}
                    <span
                        className={cn(
                            "truncate font-medium",
                            size === "compact" ? "text-xs" : "text-sm",
                        )}
                    >
                        {title}
                    </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {summary && (!summaryCollapsedOnly || !isOpen) ? (
                        <span className="max-w-[220px] truncate text-right text-xs text-muted-foreground">
                            {summary}
                        </span>
                    ) : null}
                    {extra ? (
                        <span
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                        >
                            {extra}
                        </span>
                    ) : null}
                    {locked ? (
                        <Tooltip title={lockedReason}>
                            <Lock size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                        </Tooltip>
                    ) : opensDrawer ? (
                        <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                    ) : collapsible ? (
                        isOpen ? (
                            <CaretDown size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                        ) : (
                            <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                        )
                    ) : null}
                </div>
            </div>

            {opensDrawer ? null : (
                <HeightCollapse open={isOpen}>
                    <div className="flex flex-col gap-3 pb-4">{children}</div>
                </HeightCollapse>
            )}
        </div>
    )
}
