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
import {type ReactNode, useCallback, useEffect, useRef, useState} from "react"

import {CaretDown, CaretRight, Lock} from "@phosphor-icons/react"
import {Tooltip, Typography} from "antd"

import {cn} from "../../../utils/styles"
import {HeightCollapse} from "../../HeightCollapse"

const {Text} = Typography

export type SectionIndicatorTone = "draft" | "invalid" | "incomplete" | "agent"

/**
 * The accent token for a section/item change indicator. Single source of truth for the
 * tone→token mapping, shared by the section header and the config panel's item indicators.
 * "agent" (the agent changed this in a self-commit) is deliberately DISTINCT from "draft"
 * blue — it uses the agent teal so it can't be read as the user's own unsaved edits.
 */
export function sectionIndicatorColor(tone: SectionIndicatorTone): string {
    return tone === "invalid"
        ? "var(--ag-colorError)"
        : tone === "incomplete"
          ? "var(--ag-colorWarning)"
          : tone === "agent"
            ? "var(--ag-c-13C2C2, #13c2c2)"
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
    indicator?: {tone: SectionIndicatorTone; tooltip?: ReactNode}
    /** Only show `summary` while the section is collapsed. @default false (always). */
    summaryCollapsedOnly?: boolean
    /**
     * Small status pill rendered immediately after the title (e.g. "Connect key"). Kept `shrink-0`
     * while the title itself truncates, so a long title + badge + summary never overlap.
     */
    titleBadge?: ReactNode
    /** Additional CSS class for the section wrapper. */
    className?: string
    /**
     * Fade + subtle rise the section in on mount (opacity/transform only — no layout impact). Off by
     * default so existing usages are unchanged; the agent config panel opts in (staggered via
     * `revealDelayMs`) so its sections don't pop in when the panel resolves. Motion-safe.
     */
    revealOnMount?: boolean
    /** Stagger for `revealOnMount` — delay (ms) before this section fades in. @default 0 */
    revealDelayMs?: number
    /**
     * Mount the section COLLAPSED and expand it a beat later through the normal collapse
     * transition. First paint then matches a collapsed-rows skeleton (no layout shift when the
     * panel resolves); the content unfolds instead of appearing pre-expanded. Uncontrolled,
     * collapsible, `defaultOpen` sections only — a no-op everywhere else.
     */
    animateInitialOpen?: boolean
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
    titleBadge,
    className,
    revealOnMount = false,
    revealDelayMs = 0,
    animateInitialOpen = false,
    children,
}: ConfigAccordionSectionProps) {
    // Height (0→auto via the grid `0fr`→`1fr` trick) + opacity reveal on mount (opt-in). `revealed`
    // flips one tick after mount (staggered by `revealDelayMs`) to play the transition; `done` fires
    // after it settles and drops the grid/overflow wrapper so nothing (e.g. an indicator dot) can clip.
    // Both start true when not animating, so every non-opting usage is byte-for-byte unchanged.
    const [revealed, setRevealed] = useState(!revealOnMount)
    const [done, setDone] = useState(!revealOnMount)
    useEffect(() => {
        if (!revealOnMount) return
        const reveal = window.setTimeout(() => setRevealed(true), revealDelayMs)
        const settle = window.setTimeout(() => setDone(true), revealDelayMs + 340)
        return () => {
            window.clearTimeout(reveal)
            window.clearTimeout(settle)
        }
    }, [revealOnMount, revealDelayMs])
    // Indicator (unsaved edits / validation) takes precedence over the completion `status`.
    const indicatorColor = indicator ? sectionIndicatorColor(indicator.tone) : null
    // Keep the last tone's color while the dot scales out, so it doesn't flash colorless.
    const lastIndicatorColorRef = useRef<string | null>(null)
    if (indicatorColor) lastIndicatorColorRef.current = indicatorColor
    const dotColor = indicatorColor ?? lastIndicatorColorRef.current
    // The glyph gets a soft, desaturated tint; the full accent lives on the dot so it still reads.
    const iconColor = indicatorColor
        ? `color-mix(in srgb, ${indicatorColor} 45%, var(--ag-colorTextTertiary))`
        : status === "complete"
          ? "var(--ag-colorSuccess)"
          : status === "warning"
            ? "var(--ag-colorWarning)"
            : "var(--ag-c-586673,#586673)"
    const isControlled = open !== undefined
    // With `animateInitialOpen`, a default-open section still MOUNTS closed and expands via the
    // effect below, so its first paint is the collapsed row (matching skeletons), not the content.
    const [internalOpen, setInternalOpen] = useState(animateInitialOpen ? false : defaultOpen)
    useEffect(() => {
        if (!animateInitialOpen || !defaultOpen || isControlled || !collapsible) return
        const t = window.setTimeout(() => setInternalOpen(true), 120)
        return () => window.clearTimeout(t)
        // Mount-only: this drives a one-shot entrance, never reacts to later prop changes.
    }, [])
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

    const sectionInner = (
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
                                className="relative flex shrink-0 items-center motion-safe:transition-colors motion-safe:duration-300"
                                style={{color: iconColor}}
                            >
                                {icon}
                                {/* Always mounted: state changes play as scale/opacity/color
                                    transitions instead of the dot popping in and out. */}
                                <span
                                    className={cn(
                                        "absolute -right-1 -top-0.5 h-2 w-2 rounded-full border-[1.5px] border-[var(--ag-colorBgContainer)]",
                                        "motion-safe:transition-[transform,opacity,background-color] motion-safe:duration-300 motion-safe:ease-out",
                                        indicator ? "scale-100 opacity-100" : "scale-0 opacity-0",
                                    )}
                                    style={{background: dotColor ?? undefined}}
                                />
                            </span>
                        </Tooltip>
                    ) : null}
                    <Text
                        className={cn(
                            "min-w-0 truncate font-medium",
                            size === "compact" ? "text-xs" : "text-sm",
                        )}
                    >
                        {title}
                    </Text>
                    {titleBadge ? <span className="shrink-0">{titleBadge}</span> : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {summary && (!summaryCollapsedOnly || !isOpen) ? (
                        <Text
                            type="secondary"
                            className="max-w-[220px] truncate text-right text-xs"
                        >
                            {summary}
                        </Text>
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

    // Once the mount reveal has settled, render the section directly — no grid/overflow wrapper, so it
    // behaves exactly like a non-animating section (no clipping, no extra nodes).
    if (!revealOnMount || done) return sectionInner

    // Mount reveal: animate height 0→auto (the grid `0fr`→`1fr` trick — the correct way to transition to
    // an intrinsic height) plus opacity. `min-h-0` lets the row collapse below content; `overflow-hidden`
    // clips the growing content. Motion-safe, so reduced-motion users just get the staggered appearance.
    return (
        <div
            className={cn(
                "grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-out",
                revealed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
        >
            <div className="min-h-0 overflow-hidden">{sectionInner}</div>
        </div>
    )
}
