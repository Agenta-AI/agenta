import {
    AutomationLastRunCell,
    automationStatus,
    runsWhenLabel,
    type Automation,
} from "@agenta/automation-ui"
import {AgentChip} from "@agenta/entity-ui/agent"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationKindMark} from "./AutomationKindMark"
import {AutomationStatusMark} from "./AutomationStatusMark"

/**
 * What an automation's card holds — the frame draws the tile around it.
 *
 * The row's four questions, stacked: what it is on top, whether it is working and when it runs
 * beneath, and the agent and the last run along the bottom, where a reader scanning cards
 * looks last.
 */
export const AutomationCardBody = ({
    automation,
    agentName,
    base,
}: {
    automation: Automation
    /** Already resolved by the screen — the same label the row's Agent cell reads. */
    agentName: string | null
    base: string
}) => {
    // Run outcomes land in W6; until then nothing here has failed.
    const status = automationStatus(automation, false)
    const runsWhen = runsWhenLabel(automation)

    return (
        <>
            <span className="flex min-w-0 items-center gap-2">
                <AutomationKindMark kind={automation.kind} />
                <span
                    className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground"
                    title={automation.name}
                >
                    {automation.name}
                </span>
                {/* The menu's own clicks are not the card's: without this every menu press
                    would also open the detail screen. */}
                <span
                    className="flex shrink-0 items-center"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <AutomationActionsMenu automation={automation} base={base} surface="list" />
                </span>
            </span>
            <span className="flex min-w-0 flex-col gap-1">
                <AutomationStatusMark status={status} />
                <span className="truncate text-[12.5px] text-muted-foreground" title={runsWhen}>
                    {runsWhen}
                </span>
            </span>
            {/* Agent on the left, last run on the right — the card's two corners, the way the
                row's columns read. */}
            <span className="mt-auto flex min-w-0 items-center gap-2 pt-1">
                {agentName ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <AgentChip workflowId={automation.agentId} box="size-5" glyph={13} />
                        <span className="truncate text-[12.5px] text-foreground" title={agentName}>
                            {agentName}
                        </span>
                    </span>
                ) : (
                    <span className="text-[12.5px] text-muted-foreground">—</span>
                )}
                <span className="ml-auto shrink-0 text-right">
                    <AutomationLastRunCell automation={automation} />
                </span>
            </span>
        </>
    )
}
