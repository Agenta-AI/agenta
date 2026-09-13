import {RefreshCw, TriangleAlert} from "lucide-react"

import {Button} from "@/components/ui/button"

/**
 * The list failed to load.
 *
 * Framed, unlike the empty states: those sit under a header row that is still true, while this
 * one replaces the table because there are no columns to stand under.
 */
export const SessionsError = ({
    message = "Could not load sessions.",
    onRetry,
}: {
    message?: string
    onRetry?: () => void
}) => (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-solid border-border p-10 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <p className="m-0 text-[14px] font-medium text-foreground">{message}</p>
        {onRetry ? (
            <Button variant="outline" size="sm" className="text-xs font-normal" onClick={onRetry}>
                <RefreshCw className="size-3" />
                Try again
            </Button>
        ) : null}
    </div>
)
