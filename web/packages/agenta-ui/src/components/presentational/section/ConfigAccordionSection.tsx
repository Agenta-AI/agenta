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

import {Lock} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"
import {HeightCollapse} from "../../HeightCollapse"
import {IconTile} from "../../ui/icon-tile"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../ui/tooltip"

import {
    ConfigRowCaret,
    ConfigRowDrawerCaret,
    ConfigRowTrailing,
    ConfigRowTriangle,
} from "./ConfigRowTrailing"

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
        ? "var(--destructive)"
        : tone === "incomplete"
          ? "var(--warning)"
          : tone === "agent"
            ? "light-dark(#113955, #8CCFFF)"
            : "var(--info)"
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
     * (`"invalid"`), or an optional gap (`"incomplete"`). `pulse` (a change made from another
     * pane) draws nothing extra: the dot fading in shows the change, with no ping or shimmer
     * (MOTION-02).
     */
    indicator?: {tone: SectionIndicatorTone; tooltip?: ReactNode; pulse?: boolean}
    /** Only show `summary` while the section is collapsed. @default false (always). */
    summaryCollapsedOnly?: boolean
    /**
     * Small status pill rendered immediately after the title (e.g. "Connect key"). Kept `shrink-0`
     * while the title itself truncates, so a long title + badge + summary never overlap.
     */
    titleBadge?: ReactNode
    /** Keep the title intact and truncate the summary first. @default false */
    preserveTitle?: boolean
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
    /**
     * Draw the row at a canvas scale. `"panel"`: the agent Configuration panel (canvas F01), a
     * 40 px row with a 4 px inset, 13 px title, 12 px summary, a light divider and triangle carets.
     * `"pane"`: the builder page pane (canvas B03), a 45 px full-width row with a 16 px inset,
     * 14 px title and 13 px summary. Off keeps today's rows.
     */
    canvas?: "panel" | "pane"
    /**
     * A row that opens a view (`onOpen`) ends with a chevron; `"triangle"` gives it the canvas
     * caret of the rows around it (the Advanced row, canvas F01).
     */
    drawerAffordance?: "chevron" | "triangle"
    /** Tint the header row (the builder page's "Changed by the builder", canvas B03). */
    highlight?: boolean
    /** Draw the icon on a 24 px {@link IconTile}, the same Mark the section's item rows use. */
    iconTile?: boolean
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
    preserveTitle = false,
    className,
    headerBand,
    revealOnMount = false,
    revealDelayMs = 0,
    animateInitialOpen = false,
    bodyClassName = "flex flex-col gap-3 pb-4 pt-3",
    canvas,
    drawerAffordance = "chevron",
    highlight = false,
    iconTile = false,
    children,
}: ConfigAccordionSectionProps) {
    const divider = "border-border-muted"
    const titleSize =
        size === "compact"
            ? "text-label"
            : canvas === "pane"
              ? "text-body leading-5"
              : canvas
                ? "text-label leading-5"
                : "text-body"
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
        ? `color-mix(in srgb, ${indicatorColor} 45%, var(--muted-foreground))`
        : status === "complete"
          ? "var(--success)"
          : status === "warning"
            ? "var(--warning)"
            : "var(--muted-foreground)"
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

    const iconNode = icon ? (
        <span
            className={cn(
                "relative flex shrink-0 items-center motion-safe:transition-colors motion-safe:duration-[var(--duration-base)] motion-safe:ease-[var(--ease-out)]",
                // A list row's icon is `icon-lg` (16px), whatever size the section passes (ICON-04).
                canvas && !iconTile && "[&>svg]:size-4",
            )}
            style={{color: iconColor}}
        >
            {iconTile ? (
                // A 28 px tile with a 16 px glyph: one step up from the item rows' Mark.
                <IconTile
                    size={24}
                    className="size-7 [&_svg]:size-4"
                    style={{color: iconColor}}
                >
                    {icon}
                </IconTile>
            ) : (
                icon
            )}
            {/* Always mounted: state changes play as scale/opacity/color
                transitions instead of the dot popping in and out. */}
            <span
                className={cn(
                    "absolute -right-1 -top-0.5 size-2 rounded-full ring-2 ring-background",
                    // The dot fades in and out; it never scales (MOTION-02).
                    "motion-safe:transition-[opacity,background-color] motion-safe:duration-[var(--duration-base)] motion-safe:ease-[var(--ease-out)]",
                    indicator ? "opacity-100" : "opacity-0",
                )}
                style={{background: dotColor ?? undefined}}
            />
        </span>
    ) : null

    const iconAffordance =
        icon && indicator?.tooltip ? (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>{iconNode}</TooltipTrigger>
                    <TooltipContent>{indicator.tooltip}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        ) : (
            iconNode
        )

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
                          "border-0 border-b border-solid transition-colors duration-[var(--duration-base)] ease-[var(--ease-in-out)]",
                          banded
                              ? "border-transparent bg-secondary"
                              : cn("bg-transparent", noDivider ? "border-transparent" : divider),
                      )
                    : !noDivider && cn("border-0 border-b border-solid", divider),
                className,
            )}
        >
            {/* Row stays clickable but is not the role=button node — it holds `extra`'s controls
                (nested-interactive). The button role lives on the title group below. */}
            <div
                onClick={headerActs ? activate : undefined}
                className={cn(
                    "flex items-center justify-between gap-2 select-none",
                    // The panel row is a one-line row (ROW-01) that hangs its hover fill 8 px out,
                    // so its icon stays on the content line (ALIGN-01); the pane's row is 45 px
                    // plus the divider (B03).
                    canvas === "pane"
                        ? "h-[45px] px-4"
                        : canvas
                          ? iconTile
                              ? // The tiled panel row: 40 px tall, a 10 px inset each side.
                                "-mx-2.5 h-10 rounded-lg px-2.5"
                              : "-mx-2 h-row-single rounded-md px-2"
                          : "py-3",
                    canvas === "panel" &&
                        headerActs &&
                        !locked &&
                        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-accent",
                    highlight && "bg-info/10",
                    locked && "cursor-not-allowed opacity-60",
                    headerActs && "cursor-pointer",
                    // Header fill: bled to the section edges and layered over the section's body fill so
                    // the header reads a touch stronger than the content beneath it. Fades with the band.
                    headerBand &&
                        cn(
                            headerBand,
                            "transition-colors duration-[var(--duration-base)] ease-[var(--ease-in-out)]",
                            banded ? "bg-secondary" : "bg-transparent",
                        ),
                )}
            >
                <div
                    role={headerActs ? "button" : undefined}
                    aria-expanded={opensDrawer ? undefined : collapsible ? isOpen : undefined}
                    aria-disabled={locked || undefined}
                    tabIndex={headerActs ? 0 : undefined}
                    onKeyDown={(e) => {
                        if (!headerActs) return
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            activate()
                        }
                    }}
                    className={cn(
                        "flex items-center gap-2 rounded-sm outline-none",
                        headerActs && "focus-ring",
                        preserveTitle ? "shrink-0 max-w-full" : "min-w-0",
                    )}
                >
                    {iconAffordance}
                    <span className="relative flex min-w-0">
                        <span className={cn("min-w-0 truncate font-medium", titleSize)}>
                            {title}
                        </span>
                    </span>
                    {titleBadge ? <span className="shrink-0">{titleBadge}</span> : null}
                </div>

                <ConfigRowTrailing
                    className={preserveTitle ? "min-w-0" : "shrink-0"}
                    // A non-collapsible row never carries an affordance, so it keeps no column.
                    reserve={collapsible || opensDrawer || locked}
                    affordance={
                        locked ? (
                            lockedReason ? (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Lock size={14} className="text-[var(--ag-zinc-5)]" />
                                        </TooltipTrigger>
                                        <TooltipContent>{lockedReason}</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            ) : (
                                <Lock size={14} className="text-[var(--ag-zinc-5)]" />
                            )
                        ) : opensDrawer ? (
                            canvas && drawerAffordance === "triangle" ? (
                                <ConfigRowTriangle />
                            ) : (
                                <ConfigRowDrawerCaret />
                            )
                        ) : collapsible ? (
                            canvas ? (
                                <ConfigRowTriangle open={isOpen} />
                            ) : (
                                <ConfigRowCaret open={isOpen} />
                            )
                        ) : null
                    }
                >
                    {summary && (!summaryCollapsedOnly || !isOpen) ? (
                        // antd `Text type="secondary"` is colorTextDescription, not colorTextSecondary.
                        // The title gives way, not the summary — a percentage cap here resolved
                        // against this shrink-to-fit cluster, i.e. the text's own width, so it
                        // clipped even "1 file" to "1 f…". `preserveTitle` swaps which half yields.
                        <span
                            className={cn(
                                "text-right",
                                canvas === "pane"
                                    ? "text-label leading-5 text-muted-foreground"
                                    : canvas
                                      ? "text-meta text-muted-foreground"
                                      : "text-meta text-muted-foreground",
                                preserveTitle ? "min-w-0 truncate" : "shrink-0 whitespace-nowrap",
                            )}
                        >
                            {summary}
                        </span>
                    ) : null}
                    {extra ? (
                        // `-my-2` keeps a full-height control (e.g. a 32px antd add-button) from
                        // stretching the header past its text-driven height, so every section row
                        // stays the same height whether or not it has an `extra` action.
                        <span
                            className="-my-2 flex items-center"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                        >
                            {extra}
                        </span>
                    ) : null}
                </ConfigRowTrailing>
            </div>

            {opensDrawer ? null : (
                // The 4px bleed keeps a focused control's 3px ring inside the collapse's clip.
                <HeightCollapse open={isOpen} className="-mx-1" contentClassName="px-1">
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
                "grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-[var(--duration-base)] motion-safe:ease-[var(--ease-out)]",
                revealed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
        >
            <div className="min-h-0 overflow-hidden">{sectionInner}</div>
        </div>
    )
}
