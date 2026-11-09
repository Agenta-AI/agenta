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
import {useCallback, useState, type ComponentProps, type CSSProperties, type ReactNode} from "react"

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
/** One width for every tab, so the strip shows a whole number of them. No outline: the open
 * tab is the page's own colour, and the bar's darker ground is its edge. */
const CONNECTED = "h-8 w-[180px] gap-2 rounded-t-[6px] px-3 text-xs"
/** The open tab's lower corners curve outward into the page, as browser tabs do. The shadow
 * paints the page colour into the curve's outer side. */
const FLARE = "pointer-events-none absolute bottom-0 h-1 w-1"
const FLARE_LEFT = "-left-1 rounded-br-[4px] shadow-[2px_2px_0_2px_var(--ag-surface-canvas)]"
const FLARE_RIGHT = "-right-1 rounded-bl-[4px] shadow-[-2px_2px_0_2px_var(--ag-surface-canvas)]"

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
        // Don't unmount the cluster out from under keyboard focus (symmetric with onBlurChip).
        if (!e.currentTarget.contains(document.activeElement)) setHot(false)
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
                "group relative flex shrink-0 cursor-pointer select-none items-center transition-colors",
                connected ? CONNECTED : CHIP,
                connected
                    ? active
                        ? "bg-[var(--ag-surface-canvas)] font-medium text-colorText"
                        : "text-colorTextSecondary hover:bg-[var(--ag-surface-tab-hover)] hover:text-colorText"
                    : active
                      ? "bg-[color-mix(in_srgb,var(--ag-colorFill)_90%,transparent)] text-colorText"
                      : "text-colorTextSecondary hover:bg-colorFillTertiary",
                className,
            )}
        >
            {connected && active ? (
                <>
                    <span aria-hidden className={clsx(FLARE, FLARE_LEFT)} />
                    <span aria-hidden className={clsx(FLARE, FLARE_RIGHT)} />
                </>
            ) : null}
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
                className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left [&_input]:select-text"
                style={!maskLabel ? undefined : actions ? LABEL_MASK_HOVER : LABEL_MASK_REST}
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
                        connected ? "right-2" : "right-1",
                    )}
                >
                    {actions}
                </div>
            ) : null}
        </div>
    )
}
