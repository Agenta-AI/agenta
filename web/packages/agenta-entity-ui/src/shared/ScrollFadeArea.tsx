/** A scroll box whose top and bottom edges fade while more content sits past them. */
import {useRef, type ReactNode} from "react"

import {useScrollFadeEdges} from "@agenta/ui/hooks"
import clsx from "clsx"

export function ScrollFadeArea({className, children}: {className?: string; children: ReactNode}) {
    const ref = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(ref)
    return (
        <div ref={ref} className={clsx("ag-scroll-fade overflow-y-auto", className)}>
            {children}
        </div>
    )
}
