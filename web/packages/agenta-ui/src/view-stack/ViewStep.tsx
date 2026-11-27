import {useState, type AnimationEvent, type ReactNode} from "react"

import {cn} from "../components/ui/utils"

export type ViewDirection = "forward" | "back"

/** The enter class for a view or step that moved in `direction` (MOTION-01). */
export const viewEnterClass = (direction: ViewDirection | null) =>
    direction === "back" ? "ag-view-enter-back" : direction ? "ag-view-enter" : undefined

/**
 * A step inside a view: a new `step` swaps in with the view motion, from the right when `index`
 * grows and from the left when it shrinks (or as `direction` says). The first step does not move:
 * the view's own enter covers it.
 */
export const ViewStep = ({
    step,
    index = 0,
    direction,
    className,
    inert,
    children,
}: {
    step: string
    /** The step's place in its flow; a lower index is a step back. */
    index?: number
    /** Which way the flow moved, when the caller knows it better than `index`. */
    direction?: ViewDirection
    className?: string
    inert?: boolean
    children: ReactNode
}) => {
    const [last, setLast] = useState<{step: string; index: number; dir: ViewDirection | null}>({
        step,
        index,
        dir: null,
    })
    let dir = last.dir
    if (last.step !== step) {
        dir = direction ?? (index < last.index ? "back" : "forward")
        setLast({step, index, dir})
    }
    // Played once: a later display change (a view closing over it) must not replay it.
    const settle = (event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) setLast((prev) => ({...prev, dir: null}))
    }
    return (
        <div
            key={step}
            className={cn(viewEnterClass(dir), className)}
            inert={inert}
            onAnimationEnd={settle}
        >
            {children}
        </div>
    )
}
