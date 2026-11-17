import {createT} from "@agenta/i18n"
import cellsCatalog from "@agenta/i18n/catalogs/observabilityUi.cells"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"

import {Chip} from "../primitives/Chip"

// Rendered once per session row, so it reads text with no hook of its own.
const tNow = createT(cellsCatalog)

export const SessionIdCell = ({sessionId}: {sessionId: string}) => {
    return (
        <TooltipWithCopyAction
            copyText={sessionId || ""}
            title={tNow("observabilityUi.cells.copySessionId")}
        >
            {/* was bg-[var(--ag-c-0517290F)] — a raw palette literal that breaks on mobile */}
            <Chip className="font-mono max-w-full truncate inline-block align-middle">
                # {sessionId}
            </Chip>
        </TooltipWithCopyAction>
    )
}
