import {createT} from "@agenta/i18n"
import cellsCatalog from "@agenta/i18n/catalogs/observabilityUi.cells"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {Badge} from "@agenta/ui/ui"

// Rendered once per session row, so it reads text with no hook of its own.
const tNow = createT(cellsCatalog)

export const SessionIdCell = ({sessionId}: {sessionId: string}) => {
    return (
        <TooltipWithCopyAction
            copyText={sessionId || ""}
            title={tNow("observabilityUi.cells.copySessionId")}
        >
            <Badge className="font-mono max-w-full truncate inline-block align-middle">
                # {sessionId}
            </Badge>
        </TooltipWithCopyAction>
    )
}
