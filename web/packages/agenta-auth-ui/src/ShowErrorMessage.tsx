import clsx from "clsx"

import type {AuthMessage} from "./types"

export const ShowErrorMessage = ({
    info,
    className,
}: {
    info: Partial<AuthMessage>
    className?: string
}) => (
    <div className={clsx("mb-4 text-center", className)}>
        <span className="font-medium text-colorError">{info.message}</span>
        <div className="text-colorTextSecondary">{info.sub}</div>
    </div>
)
