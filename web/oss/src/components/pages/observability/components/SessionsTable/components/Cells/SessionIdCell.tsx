import {Badge} from "@agenta/primitive-ui/components/badge"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"

export const SessionIdCell = ({sessionId}: {sessionId: string}) => {
    return (
        <TooltipWithCopyAction copyText={sessionId || ""} title="Copy session id">
            <Badge
                className="font-mono bg-[var(--ag-c-0517290F)] max-w-full truncate inline-block align-middle"
                variant="secondary"
            >
                # {sessionId}
            </Badge>
        </TooltipWithCopyAction>
    )
}
