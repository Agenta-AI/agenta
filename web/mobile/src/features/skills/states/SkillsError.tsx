import {Button} from "@agenta/ui/ui"
import {RefreshCw, TriangleAlert} from "lucide-react"

/**
 * The registry failed to load.
 *
 * Framed, unlike the empty states: those sit under a header row that is still true, while this
 * one replaces the results because there is nothing left standing to hold them. A request that
 * never answered must not read as "No skills yet".
 */
export const SkillsError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-solid border-border p-10 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <p className="m-0 text-[14px] font-medium text-foreground">Could not load skills.</p>
        <Button variant="outline" size="sm" className="text-xs font-normal" onClick={onRetry}>
            <RefreshCw className="size-3" />
            Try again
        </Button>
    </div>
)
