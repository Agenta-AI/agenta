import {RefreshCw, TriangleAlert} from "lucide-react"

import {Button} from "@/components/ui/button"

/**
 * The roster failed to load.
 *
 * Framed, unlike the empty states: those sit under a header row that is still true, while this
 * one replaces the results because there is nothing left standing to hold them.
 *
 * It exists so a failed fetch cannot read as an empty project — "No agents yet" is a claim, and
 * a request that never answered is not evidence for it.
 */
export const AgentsError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-solid border-border p-10 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <p className="m-0 text-[14px] font-medium text-foreground">Could not load agents.</p>
        <Button variant="outline" size="sm" className="text-xs font-normal" onClick={onRetry}>
            <RefreshCw className="size-3" />
            Try again
        </Button>
    </div>
)
