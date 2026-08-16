import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"

import {Chip} from "../primitives/Chip"

export const SessionIdCell = ({sessionId}: {sessionId: string}) => {
    return (
        <TooltipWithCopyAction copyText={sessionId || ""} title="Copy session id">
            {/* was bg-[var(--ag-c-0517290F)] — a raw palette literal that breaks on mobile */}
            <Chip className="font-mono max-w-full truncate inline-block align-middle">
                # {sessionId}
            </Chip>
        </TooltipWithCopyAction>
    )
}
