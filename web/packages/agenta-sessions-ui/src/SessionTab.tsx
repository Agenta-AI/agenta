/**
 * THE session chip — one tab in a session strip. Extracted from the desktop playground's
 * `SessionTagBar` (which now renders this), so the chip geometry, the active treatment and the
 * hover-actions behaviour exist once for every surface that shows sessions as tabs.
 *
 * What the chip owns: geometry, the active/inactive skin, keyboard select, and the hover/focus
 * state that decides whether the actions cluster is MOUNTED (rendering it behind `opacity-0` would
 * keep every chip's tooltip + icon subtree alive).
 *
 * What the host owns, as slots: the status dot (each surface derives status from its own source),
 * the label (the desktop's is an inline-rename input), and the actions themselves.
 *
 * Rest props land on the root, so a host can wrap it in a Radix `asChild` trigger (the desktop's
 * context menu does).
 */
import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type ComponentProps,
    type CSSProperties,
    type ReactNode,
} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {PushPin} from "@phosphor-icons/react"
import clsx from "clsx"

/** No hover to reveal the actions with, so they stay mounted — the pencil is the touch path. */
const NO_HOVER_QUERY = "(hover: none)"

/** The label's tail dissolves into the chip's own fill — never an ellipsis, never a painted
 * patch, so it works on any theme. Hover widens the fade to clear the action icons; the label
 * element's width never changes, so nothing reflows. */
const maskStyle = (img: string): CSSProperties => ({WebkitMaskImage: img, maskImage: img})
const LABEL_MASK_REST = maskStyle("linear-gradient(to right, #000 calc(100% - 14px), transparent)")
const LABEL_MASK_HOVER = maskStyle(
    "linear-gradient(to right, #000 calc(100% - 60px), transparent calc(100% - 38px))",
)

/** Label-sized between a floor (clickable zone left of the hover actions) and a ceiling. No
 * border: plain labels separated by the host's hairline; selected reads by fill alone. */
const CHIP = "h-7 w-fit min-w-20 max-w-32 gap-1.5 rounded px-2 text-xs"
/** Sized to the name, up to a cap, so a short name leaves no gap beside it; the open tab gets
 * a wider cap. No outline: the open tab is the page's own colour, and the bar is its edge. */
// `--strip-tab-max`: the strip's room, so a tab never outgrows a strip that fits only one.
const CONNECTED =
    "isolate h-8 w-fit min-w-16 max-w-[min(160px,var(--strip-tab-max,160px))] gap-2 rounded-t-[6px] px-3 text-xs"
/** The open tab's page-coloured surface. `isolate` on the tab keeps it behind the label. */
const SURFACE =
    "pointer-events-none absolute inset-0 -z-10 origin-left rounded-t-[6px] bg-background will-change-transform"
/** Where the last open tab's surface sat, so the next one can grow out of it. One strip shows
 * at a time, so one slot is enough. */
let lastSurface: {rect: DOMRect; at: number} | null = null
/** Older than this, the last surface belongs to another visit, not to a switch. */
const GLIDE_WINDOW_MS = 1500
/** A soft spring as a curve: it overshoots a little and settles, so the surface stretches
 * across and lands with some give. */
const SURFACE_GLIDE = {duration: 420, easing: "cubic-bezier(0.32, 1.32, 0.5, 1)"}

/** The surface glides from the previous open tab into this one: FLIP on its transform. */
const useSurfaceGlide = () => {
    const ref = useRef<HTMLSpanElement>(null)
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const to = el.getBoundingClientRect()
        const from =
            lastSurface && performance.now() - lastSurface.at < GLIDE_WINDOW_MS
                ? lastSurface.rect
                : null
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches
        if (from && !still && Math.abs(from.left - to.left) > 1) {
            // Transform only, so the compositor runs it: the route's own render lands mid-glide,
            // and a layout-driven animation stalled there.
            el.animate(
                [
                    {
                        transform: `translateX(${from.left - to.left}px) scaleX(${from.width / to.width})`,
                    },
                    {transform: "translateX(0) scaleX(1)"},
                ],
                SURFACE_GLIDE,
            )
        }
        // Read on the way out: the next open tab starts from wherever this one last was.
        return () => {
            lastSurface = {rect: el.getBoundingClientRect(), at: performance.now()}
        }
    }, [])
    return ref
}

/** The open tab's lower corners curve outward into the page, as browser tabs do. The shadow
 * paints the transcript's colour (`--background`) into the curve's outer side. They ride on the
 * travelling surface. */
const FLARE = "absolute bottom-0 h-1 w-1"
const FLARE_LEFT = "-left-1 rounded-br-[4px] shadow-[2px_2px_0_2px_var(--background)]"
const FLARE_RIGHT = "-right-1 rounded-bl-[4px] shadow-[-2px_2px_0_2px_var(--background)]"

/** Mounted only on the open tab, so its mount is the switch to animate. */
const OpenTabSurface = () => {
    const ref = useSurfaceGlide()
    return (
        <span ref={ref} aria-hidden className={SURFACE}>
            <span className={clsx(FLARE, FLARE_LEFT)} />
            <span className={clsx(FLARE, FLARE_RIGHT)} />
        </span>
    )
}

export interface SessionTabProps extends Omit<ComponentProps<"div">, "children" | "onSelect"> {
    /** The session on screen: primary text on the `colorFill` chip. */
    active: boolean
    /**
     * A page tab instead of a chip: fixed width, and the open tab takes the canvas colour and
     * flares into the page line below it, so it reads as the top of the chat pane.
     */
    connected?: boolean
    /** Text, or the host's own label element (inline rename on the desktop). */
    label: ReactNode
    /** Off while the label is an editor: the fade would dim the input's own right edge. */
    maskLabel?: boolean
    /** The run-state dot, from whichever liveness source the host has. */
    statusDot?: ReactNode
    /** Pinned: a leading pin glyph, and why this chip leads the strip. */
    pinned?: boolean
    /**
     * Called while the chip is hovered or holds focus — and always on a device with no hover, where
     * nothing would ever reveal them. Return null to suppress (a rename input owns the row).
     */
    renderActions?: () => ReactNode
    onSelect: () => void
}

export const SessionTab = ({
    active,
    connected = false,
    label,
    maskLabel = true,
    statusDot,
    pinned = false,
    renderActions,
    onSelect,
    className,
    ...rest
}: SessionTabProps) => {
    const [hot, setHot] = useState(false)
    const onEnter = useCallback(() => setHot(true), [])
    const onLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        // Keep the cluster under keyboard focus only; a click's focus must not pin it.
        const el = e.currentTarget
        if (!el.matches(":focus-visible") && !el.querySelector(":focus-visible")) setHot(false)
    }, [])
    const onBlurChip = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(false)
    }, [])
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onSelect()
            }
        },
        [onSelect],
    )

    const noHover = useMediaQuery(NO_HOVER_QUERY)
    const actions = hot || noHover ? renderActions?.() : null

    return (
        <div
            {...rest}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={onKeyDown}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            onFocus={onEnter}
            onBlur={onBlurChip}
            className={clsx(
                // `select-none`: a second click on the chip you are already on must not start
                // painting its label — a tab is a control, not text (#6379).
                "group relative flex shrink-0 cursor-pointer select-none items-center transition-colors duration-200 ease-out motion-reduce:transition-none",
                connected ? CONNECTED : CHIP,
                connected
                    ? active
                        ? "max-w-[min(200px,var(--strip-tab-max,200px))] font-medium text-colorText"
                        : "text-colorTextSecondary hover:bg-[var(--ag-surface-tab-hover)] hover:text-colorText"
                    : active
                      ? "bg-[color-mix(in_srgb,var(--ag-colorFill)_90%,transparent)] text-colorText"
                      : "text-colorTextSecondary hover:bg-colorFillTertiary",
                className,
            )}
        >
            {connected && active ? <OpenTabSurface /> : null}
            {statusDot}
            {pinned && (
                <PushPin
                    size={10}
                    weight="fill"
                    aria-hidden
                    className="shrink-0 text-colorTextTertiary"
                />
            )}
            <span
                // A rename input inside the label keeps its own selection.
                className={clsx(
                    "block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left [&_input]:select-text",
                    // A page tab cuts a long name with an ellipsis.
                    connected && "truncate [&>*]:truncate",
                )}
                style={
                    connected || !maskLabel
                        ? undefined
                        : actions
                          ? LABEL_MASK_HOVER
                          : LABEL_MASK_REST
                }
            >
                {label}
            </span>
            {/* Hover actions float over the masked tail — transparent buttons directly on the
                tag's own fill. No backing: any painted patch reads as a mismatched box against
                a chip whose only skin is that fill. */}
            {actions ? (
                <div
                    className={clsx(
                        "absolute inset-y-0 flex items-center gap-0.5",
                        // Over the name's tail on the tab's own fill, so the tab never grows on hover.
                        connected ? "right-1.5 my-auto h-5 rounded pl-1" : "right-1",
                        // The open tab's fill is the glide layer, so its own background is clear.
                        connected && (active ? "bg-background" : "bg-inherit"),
                    )}
                >
                    {actions}
                </div>
            ) : null}
        </div>
    )
}
