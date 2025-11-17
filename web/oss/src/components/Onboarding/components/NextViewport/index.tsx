import type {ReactNode} from "react"

import clsx from "clsx"
import {NextStepViewport} from "nextstepjs"

type NextViewportProps = {
    id: string
    className?: string
    children: ReactNode
}

const NextViewport = ({id, className, children}: NextViewportProps) => {
    return (
        <NextStepViewport id={id}>
            <div className={clsx("h-full w-full", className)}>{children}</div>
        </NextStepViewport>
    )
}

export default NextViewport
