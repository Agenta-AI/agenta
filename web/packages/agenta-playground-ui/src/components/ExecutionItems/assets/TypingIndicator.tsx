import {type FC} from "react"

import {Spinner} from "@agenta/ui/ui"
import clsx from "clsx"

const TypingIndicator: FC<{label?: string; className?: string; size?: "small" | "default"}> = ({
    label = "Generating response...",
    className,
    size = "default",
}) => {
    return (
        <div
            className={clsx(
                "w-full px-3 py-2 rounded-md text-label text-muted-foreground",
                className,
            )}
        >
            <Spinner
                aria-hidden
                className={clsx("inline align-middle", size === "small" ? "size-3" : "size-3.5")}
            />
            <span className="ml-2 align-middle">{label}</span>
        </div>
    )
}

export default TypingIndicator
