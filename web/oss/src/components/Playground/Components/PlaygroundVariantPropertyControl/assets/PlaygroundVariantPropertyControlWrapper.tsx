import {type HTMLProps} from "react"

import clsx from "clsx"

const PlaygroundVariantPropertyControlWrapper = ({
    className,
    children,
    ...props
}: HTMLProps<HTMLDivElement>) => {
    return (
        <div
            className={clsx(
                "playground-property-control",
                "flex flex-col gap-2 mb-[13px]",
                "[&_.playground-property-control-label]:!font-[500]",
                "[&_.playground-property-control-label]:!capitalize",
                className,
            )}
            {...props}
        >
            {children}
        </div>
    )
}

export default PlaygroundVariantPropertyControlWrapper
