import {ReactNode} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import Image from "next/image"

const NoResultsFound = ({
    className,
    title,
    description,
    primaryActionLabel = "Create your first evaluator",
    onPrimaryAction,
    primaryActionSlot,
}: {
    className?: string
    title?: string
    description?: string
    primaryActionLabel?: string
    onPrimaryAction?: () => void
    /** Custom slot to render instead of the default primary action button */
    primaryActionSlot?: ReactNode
}) => {
    return (
        <div
            className={`w-full flex flex-col items-center justify-center py-20 gap-4 ${className}`}
        >
            <Image src="/assets/not-found.png" alt="not-found" width={240} height={210} />
            <span className="leading-[1.4] text-xl font-medium text-colorText">
                {!title ? "No Results found" : title}
            </span>
            <p className="text-muted-foreground">
                {!description ? "No results match the search criteria." : description}
            </p>
            {primaryActionSlot
                ? primaryActionSlot
                : onPrimaryAction && (
                      <Button onClick={onPrimaryAction}>{primaryActionLabel}</Button>
                  )}
        </div>
    )
}

export default NoResultsFound
