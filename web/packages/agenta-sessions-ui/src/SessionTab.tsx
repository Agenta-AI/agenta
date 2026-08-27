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

import {PushPin} from "@phosphor-icons/react"
import clsx from "clsx"

/** The label's tail dissolves into the chip's own fill — never an ellipsis, never a painted
 * patch, so it works on any theme. Hover widens the fade to clear the action icons; the label
 * element's width never changes, so nothing reflows. */
const maskStyle = (img: string): CSSProperties => ({WebkitMaskImage: img, maskImage: img})
const LABEL_MASK_REST = maskStyle("linear-gradient(to right, #000 calc(100% - 14px), transparent)")
const LABEL_MASK_HOVER = maskStyle(
    "linear-gradient(to right, #000 calc(100% - 60px), transparent calc(100% - 38px))",
)

export interface SessionTabProps extends Omit<ComponentProps<"div">, "children" | "onSelect"> {
    /** The session on screen: primary text on the `colorFill` chip. */
    active: boolean
    /** Text, or the host's own label element (inline rename on the desktop). */
    label: ReactNode
    /** The run-state dot, from whichever liveness source the host has. */
    statusDot?: ReactNode
    /** Pinned: a leading pin glyph, and why this chip leads the strip. */
    pinned?: boolean
    /**
     * Called only while the chip is hovered or holds focus. Return null to suppress (the desktop
     * does while its rename input owns the row).
     */
    renderActions?: () => ReactNode
    onSelect: () => void
}

export const SessionTab = ({
    active,
    label,
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

    const actions = hot ? renderActions?.() : null

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
                // Floor the width so short labels ("hi") still leave a clickable label zone to the
                // left of the hover actions (rename/close overlay the right ~58px) — otherwise a
                // tiny chip is fully covered on hover and the click lands on a button, not select.
                "group relative flex h-7 min-w-[112px] max-w-[180px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                // No card, no border — plain labels on the canvas, separated by the host's
                // hairline divider. Selected reads by FILL alone: `colorFill` is the antd
                // "pressed/active" step, ink-tinted in light and translucent white in dark,
                // clearly stronger than the whisper-of-fill hover an unselected tag gets, held
                // at 90% so the chip sits a touch lighter on the canvas.
                active
                    ? "bg-[color-mix(in_srgb,var(--ag-colorFill)_90%,transparent)] text-colorText"
                    : "text-colorTextSecondary hover:bg-colorFillTertiary",
                className,
            )}
        >
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
                className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left"
                style={actions ? LABEL_MASK_HOVER : LABEL_MASK_REST}
            >
                {label}
            </span>
            {/* Hover actions float over the masked tail — transparent buttons directly on the
                tag's own fill. No backing: any painted patch reads as a mismatched box against
                a chip whose only skin is that fill. */}
            {actions ? (
                <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                    {actions}
                </div>
            ) : null}
        </div>
    )
}
