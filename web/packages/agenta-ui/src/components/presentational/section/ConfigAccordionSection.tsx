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
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react"

import {CaretDown, CaretRight, Lock} from "@phosphor-icons/react"
import {Tooltip, Typography} from "antd"
import {motion} from "motion/react"

import {cn} from "../../../utils/styles"
import {HeightCollapse} from "../../HeightCollapse"

const {Text} = Typography

/**
 * Whether the enclosing accordion section is currently expanded. Because the body stays MOUNTED while
 * collapsed (height-0 via {@link HeightCollapse}), a child can't rely on mount to know it just became
 * visible — an `autoFocus` fires while hidden and never again. Read this instead to (re)act on open,
 * e.g. focus a field when its section unfolds. Defaults to `true` outside a section, so a child used
 * elsewhere behaves as always-open.
 */
const SectionOpenContext = createContext<boolean>(true)

/** Read whether the enclosing {@link ConfigAccordionSection} is expanded. See {@link SectionOpenContext}. */
export function useAccordionSectionOpen(): boolean {
    return useContext(SectionOpenContext)
}

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
     * (`"invalid"`), or an optional gap (`"incomplete"`). `pulse` plays a one-shot attention
     * ring behind the dot (e.g. a change made from another pane); the caller owns how long it
     * stays true (see `useRecentFlag`).
     */
    indicator?: {tone: SectionIndicatorTone; tooltip?: ReactNode; pulse?: boolean}
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
     * Opt in to the expanded-header "band" — a faint fill + bottom divider while the section is open,
     * so the header reads as a header rather than blending into its content.
     *
     * The value is the BLEED class the host needs to pull the fill out to its own edges while the
     * header text stays aligned with the content below, e.g. `"-mx-4 px-4"` inside a `px-4` container.
     * It has to come from the host because this primitive is used in containers with different
     * padding (config panel, drawers, nested sections) and a hardcoded bleed would overflow or
     * under-fill in the others. Omit for no band (the default — every existing usage is unchanged).
     */
    headerBand?: string
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
    /**
     * Override the body wrapper classes (the padded flex column around `children`). Defaults to
     * `"flex flex-col gap-3 pb-4 pt-3"`. Pass a padding-free value when the body owns its own spacing
     * — e.g. content that must collapse to zero height with no residual padding for an exit
     * transition.
     */
    bodyClassName?: string
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
    headerBand,
    revealOnMount = false,
    revealDelayMs = 0,
    animateInitialOpen = false,
    bodyClassName = "flex flex-col gap-3 pb-4 pt-3",
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
    // Whether the expanded-header band (fill + bottom divider) is currently shown. `isOpen` is already
    // false when the section opens a drawer or is locked.
    const banded = isOpen && !!headerBand

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
                // Expanded-section band (opt-in via `headerBand`): the whole expanded section shares a
                // subtle bleeding fill so it reads as one grouped, active region set apart from the flat
                // collapsed headers, using fill rather than a border. This `bg` is the BODY/content
                // shade; the header layers a second fill on top (below) so it reads a touch stronger —
                // the header/content contrast is what keeps two stacked expanded sections from blending
                // into one block (no corner rounding — flush-stacked fills read cleaner than notched
                // rounded blocks). Only COLORS change between states (the bleed is always applied; the
                // fill + row divider fade via `transition-colors` in step with the body's height
                // collapse) — nothing layout-affecting toggles, so the header never shifts and
                // opening/closing stays jump-free. The banded section drops the row divider (its fill
                // separates it); collapsed rows keep it.
                headerBand
                    ? cn(
                          headerBand,
                          "border-0 border-b border-solid transition-colors duration-300 ease-out",
                          banded
                              ? "border-transparent bg-[var(--ag-colorFillQuaternary)]"
                              : cn(
                                    "bg-transparent",
                                    noDivider
                                        ? "border-transparent"
                                        : "border-[var(--ag-c-EAEFF5,#eaeff5)]",
                                ),
                      )
                    : !noDivider &&
                          "border-0 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)]",
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
                    // Header fill: bled to the section edges and layered over the section's body fill so
                    // the header reads a touch stronger than the content beneath it. Fades with the band.
                    headerBand &&
                        cn(
                            headerBand,
                            "transition-colors duration-300 ease-out",
                            banded ? "bg-[var(--ag-colorFillQuaternary)]" : "bg-transparent",
                        ),
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
                                {/* Attention ripple: expands + fades out from behind the dot,
                                    repeating while the caller holds `pulse` true (e.g. a change
                                    from another pane). Uses `motion` so it animates reliably. */}
                                {indicator?.pulse ? (
                                    <motion.span
                                        className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full"
                                        style={{background: dotColor ?? undefined}}
                                        initial={{opacity: 0, scale: 1}}
                                        animate={{opacity: [0, 0.5, 0], scale: [1, 2, 3]}}
                                        transition={{
                                            duration: 1.8,
                                            ease: "easeOut",
                                            repeat: 1,
                                            times: [0, 0.25, 1],
                                        }}
                                    />
                                ) : null}
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
                    {/* Title. The base text stays fully opaque/crisp; while `pulse` holds, a blue
                        DUPLICATE laid exactly on top is revealed through a moving mask, so a glint
                        sweeps across the letters (in cadence with the dot ripple) without ever
                        fading the real text. Sweep = the `config-shimmer` CSS keyframe (motion is
                        unreliable at animating mask/background position). */}
                    <span className="relative flex min-w-0">
                        <Text
                            className={cn(
                                "min-w-0 truncate font-medium",
                                size === "compact" ? "text-xs" : "text-sm",
                            )}
                        >
                            {title}
                        </Text>
                        {indicator?.pulse ? (
                            <span
                                aria-hidden
                                className={cn(
                                    "animate-config-shimmer pointer-events-none absolute inset-0 truncate font-medium",
                                    size === "compact" ? "text-xs" : "text-sm",
                                )}
                                style={{
                                    color: dotColor ?? undefined,
                                    WebkitMaskImage:
                                        "linear-gradient(100deg, transparent 8%, #000 50%, transparent 92%)",
                                    maskImage:
                                        "linear-gradient(100deg, transparent 8%, #000 50%, transparent 92%)",
                                    WebkitMaskSize: "220% 100%",
                                    maskSize: "220% 100%",
                                    WebkitMaskRepeat: "no-repeat",
                                    maskRepeat: "no-repeat",
                                }}
                            >
                                {title}
                            </span>
                        ) : null}
                    </span>
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
                    {/* Top padding gives the body room below the header band (which carries the
                        fill + bottom divider), so it reads as content, not a header continuation. */}
                    <div className={bodyClassName}>
                        <SectionOpenContext.Provider value={isOpen}>
                            {children}
                        </SectionOpenContext.Provider>
                    </div>
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
