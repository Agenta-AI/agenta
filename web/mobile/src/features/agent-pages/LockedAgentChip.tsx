import {useT} from "@agenta/i18n"
import lockedFilterCatalog from "@agenta/i18n/catalogs/agentPages.lockedFilter"
import {SimpleTooltip} from "@agenta/ui/ui"
import {LockSimple} from "@phosphor-icons/react"

import {useAgentRow} from "../agent-layout/useAgentRow"

/**
 * The Agent filter of a page locked to one agent (the Sessions and Analytics pages of an agent).
 * It names the agent and cannot be removed.
 */
export const LockedAgentChip = ({agentId}: {agentId: string}) => {
    const t = useT(lockedFilterCatalog)
    const {row} = useAgentRow(agentId)
    const name = row?.name || row?.slug || ""
    return (
        <SimpleTooltip title={t("agentPages.lockedFilter.onlyThisAgent")}>
            <span
                data-testid="locked-agent-chip"
                className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs"
            >
                <span className="text-muted-foreground">{t("agentPages.lockedFilter.agent")}</span>
                <span className="max-w-[220px] truncate">{name}</span>
                <LockSimple size={12} aria-hidden className="shrink-0 text-muted-foreground" />
            </span>
        </SimpleTooltip>
    )
}
