import {useRef, type ReactNode} from "react"

import {useScrollFadeEdges} from "@agenta/ui/hooks"

import {cn} from "@/lib/utils"

/** A scroll box that fades at whichever edge still has content past it. */
export const FadingScrollBody = ({
    className,
    children,
}: {
    className?: string
    children: ReactNode
}) => {
    const ref = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(ref)
    return (
        <div ref={ref} className={cn("ag-scroll-fade", className)}>
            {children}
        </div>
    )
}
