import {type HTMLProps} from "react"

import clsx from "clsx"

const PlaygroundVariantPropertyControlWrapper = ({
    className,
    children,
    ...props
}: HTMLProps<HTMLDivElement>) => {
    return (
        <div className={clsx("flex flex-col gap-2 mb-[13px]", className)} {...props}>
            {children}
        </div>
    )
}

export default PlaygroundVariantPropertyControlWrapper
