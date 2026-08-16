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
import {useCallback, useState, type ComponentProps, type ReactNode} from "react"

import clsx from "clsx"

export interface SessionTabProps extends Omit<ComponentProps<"div">, "children" | "onSelect"> {
    /** The session on screen: primary text + the accent underline. */
    active: boolean
    /** Text, or the host's own label element (inline rename on the desktop). */
    label: ReactNode
    /** The run-state dot, from whichever liveness source the host has. */
    statusDot?: ReactNode
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
                "group relative flex h-7 min-w-[112px] max-w-[180px] cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 text-xs transition-colors",
                // White pill on the recessed chat canvas (raised); the active tab keeps the
                // primary text + a 2px accent underline so it's unmistakable against neighbours.
                active
                    ? "border-colorBorder border-b-2 border-b-[var(--ag-surface-accent)] bg-colorBgContainer text-colorText"
                    : "border-colorBorderSecondary bg-colorBgContainer text-colorTextSecondary hover:border-colorBorder",
                className,
            )}
        >
            {statusDot}
            {typeof label === "string" ? (
                <span className="block min-w-0 flex-1 truncate text-left">{label}</span>
            ) : (
                label
            )}
            {/* Hover actions overlay the label's tail — absolutely positioned so no width is
                reserved at rest (no pixel shift). The gradient fades the covered text out under
                the buttons instead of hard-clipping it. */}
            {actions ? (
                <div className="absolute inset-y-0 right-0 flex items-center">
                    <span
                        aria-hidden
                        className="h-full w-3 bg-gradient-to-l from-colorBgContainer to-transparent"
                    />
                    <span className="flex h-full items-center gap-0.5 rounded-r-md bg-colorBgContainer pr-1">
                        {actions}
                    </span>
                </div>
            ) : null}
        </div>
    )
}
