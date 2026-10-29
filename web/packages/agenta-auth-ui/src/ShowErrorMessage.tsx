import {cn} from "@agenta/ui/ui"

import {ERROR_TEXT_CLASS} from "./classes"
import type {AuthMessage} from "./types"

export const ShowErrorMessage = ({
    info,
    className,
}: {
    info: Partial<AuthMessage>
    className?: string
}) => (
    <div className={cn(ERROR_TEXT_CLASS, "text-start", className)} role="alert">
        <span>{info.message}</span>
        {info.sub ? <div className="text-muted-foreground">{info.sub}</div> : null}
    </div>
)
