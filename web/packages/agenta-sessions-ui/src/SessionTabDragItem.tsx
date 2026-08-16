/**
 * A draggable slot in a session tab strip — one `Reorder.Item` per chip, so tabs can be
 * hand-arranged like browser tabs. Pair it with `SessionTabStrip`'s `reorder` prop, which supplies
 * the `Reorder.Group` around these.
 *
 * The gesture differs per input, because a horizontal strip has to stay scrollable and because a
 * press can only mean one thing:
 * - **Mouse / pen:** drag starts on press. Their menu is right-click, so nothing competes.
 * - **Touch:** drag is OFF by default (`touchDrag`). A long press already opens the chip's context
 *   menu, and one press cannot both open a menu and lift a tab; a plain swipe has to keep scrolling
 *   the strip. Surfaces give touch the reorder verbs in that menu instead. Opt in only where the
 *   chips carry no context menu.
 *
 * `dragListener` is off either way — the press starts the drag through `dragControls`, so the
 * browser keeps the gesture until we decide it is a drag.
 *
 * Motion props pass through: the desktop's chips animate their width + gap margin on enter/exit and
 * track themselves into view via `onUpdate`, and that keeps working while they are drag slots.
 */
import {useCallback, useRef, useState, type ReactNode, type Ref} from "react"

import clsx from "clsx"
import {Reorder, useDragControls, type HTMLMotionProps} from "motion/react"

export interface SessionTabDragItemProps
    // `layout` and the drag props are the item's own business — Reorder narrows them.
    extends Omit<
        HTMLMotionProps<"div">,
        "value" | "children" | "layout" | "drag" | "dragControls" | "dragListener"
    > {
    /** The session id — the reorder key. Must appear in the group's `values`. */
    id: string
    /**
     * Let touch drag too, after a long press. Off by default: it collides with the long-press
     * context menu (see above). Only turn it on where the chips have no menu.
     */
    touchDrag?: boolean
    /** How long a touch has to hold before it becomes a drag rather than a scroll. */
    longPressMs?: number
    ref?: Ref<HTMLDivElement>
    children: ReactNode
}

export const SessionTabDragItem = ({
    id,
    touchDrag = false,
    longPressMs = 350,
    className,
    style,
    children,
    ...motionProps
}: SessionTabDragItemProps) => {
    const controls = useDragControls()
    const [dragging, setDragging] = useState(false)
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearPress = useCallback(() => {
        if (pressTimer.current) clearTimeout(pressTimer.current)
        pressTimer.current = null
    }, [])

    const onPointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            clearPress()
            // A press on the chip's own controls is that control's — dragging out of a rename input
            // would steal the text selection, and out of the close button its click.
            if (
                (event.target as HTMLElement | null)?.closest(
                    "input, textarea, button, [contenteditable='true']",
                )
            ) {
                return
            }
            if (event.pointerType !== "touch") {
                controls.start(event)
                return
            }
            if (!touchDrag) return
            pressTimer.current = setTimeout(() => controls.start(event), longPressMs)
        },
        [clearPress, controls, longPressMs, touchDrag],
    )

    return (
        <Reorder.Item
            {...motionProps}
            as="div"
            value={id}
            dragListener={false}
            dragControls={controls}
            onPointerDown={onPointerDown}
            onPointerUp={clearPress}
            onPointerCancel={clearPress}
            onPointerLeave={clearPress}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => {
                clearPress()
                setDragging(false)
            }}
            // Reorder sets `touch-action: pan-y` for an x-axis item, which would stop a touch pan on
            // a chip from scrolling the strip — and the strip is nothing but chips. The drag runs off
            // dragControls, so it does not need the browser to yield the gesture.
            style={{touchAction: "auto", ...style}}
            className={clsx(dragging && "z-10 cursor-grabbing shadow-overlay", className)}
        >
            {children}
        </Reorder.Item>
    )
}
