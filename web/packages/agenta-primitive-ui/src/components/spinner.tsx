import {SpinnerIcon} from "@phosphor-icons/react"

import {cn} from "@agenta/primitive-ui/lib/utils"

function Spinner({className, ...props}: React.ComponentProps<"svg">) {
    return (
        <SpinnerIcon
            data-slot="spinner"
            role="status"
            aria-label="Loading"
            className={cn("size-4 animate-spin", className)}
            {...props}
        />
    )
}

export {Spinner}
