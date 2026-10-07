import clsx from "clsx"

import type {AuthMessage} from "./types"

export const ShowErrorMessage = ({
    info,
    className,
}: {
    info: Partial<AuthMessage>
    className?: string
}) => (
    <div className={clsx("auth-error-text text-start", className)} role="alert">
        <span>{info.message}</span>
        {info.sub ? <div className="auth-status-text">{info.sub}</div> : null}
    </div>
)
