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
                "w-full px-3 py-2 rounded-md text-[13px] text-[var(--ag-c-667085BF)]",
                className,
            )}
        >
            <Spinner
                size={size === "small" ? "small" : "default"}
                className="align-middle text-[rgba(102,112,133,0.75)]"
            />
            <span className="ml-2 align-middle">{label}</span>
        </div>
    )
}

export default TypingIndicator
