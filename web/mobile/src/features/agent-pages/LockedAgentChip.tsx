import {useT} from "@agenta/i18n"
import lockedFilterCatalog from "@agenta/i18n/catalogs/agentPages.lockedFilter"
import {SimpleTooltip} from "@agenta/ui/ui"
import {LockSimple} from "@phosphor-icons/react"

import {useAgentRow} from "../agent-layout/useAgentRow"

/**
 * The Agent filter of a page locked to one agent (the Sessions and Analytics pages of an agent).
 * It names the agent and cannot be removed.
 *
 * - `toolbar` (Analytics, A09): a 28 px chip beside the toolbar buttons, "Agent" in gray, the name,
 *   then the lock.
 * - `inline` (Sessions, A02): a quiet 24 px tag after the filter button, the lock first, then
 *   "Agent: name".
 */
export const LockedAgentChip = ({
    agentId,
    variant = "toolbar",
}: {
    agentId: string
    variant?: "toolbar" | "inline"
}) => {
    const t = useT(lockedFilterCatalog)
    const {row} = useAgentRow(agentId)
    const name = row?.name || row?.slug || ""
    return (
        <SimpleTooltip title={t("agentPages.lockedFilter.onlyThisAgent")}>
            {variant === "inline" ? (
                <span
                    data-testid="locked-agent-chip"
                    className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-[6px] bg-muted px-2 text-[12px] text-muted-foreground"
                >
                    <LockSimple size={12} aria-hidden className="shrink-0" />
                    <span className="max-w-[260px] truncate">
                        {t("agentPages.lockedFilter.agentNamed", {name})}
                    </span>
                </span>
            ) : (
                <span
                    data-testid="locked-agent-chip"
                    className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-muted pl-2.5 pr-1 text-[13px]"
                >
                    <span className="text-muted-foreground">
                        {t("agentPages.lockedFilter.agent")}
                    </span>
                    <span className="max-w-[220px] truncate">{name}</span>
                    <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
                        <LockSimple size={12} aria-hidden />
                    </span>
                </span>
            )}
        </SimpleTooltip>
    )
}
