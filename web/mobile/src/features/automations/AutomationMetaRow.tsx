import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import {timeAgo} from "@agenta/shared/utils"

/**
 * The facts under the name: on/off, then what it runs and when it last changed.
 *
 * No owner clause — the trigger endpoints carry only a `created_by_id`, and there is no user
 * lookup in this stack to turn that into a name, so the line stops at the agent.
 */
export const AutomationMetaRow = ({
    active,
    agentName,
    updatedAt,
    onToggle,
}: {
    active: boolean
    agentName: string | null
    updatedAt: string | null
    onToggle: (next: boolean) => Promise<void>
}) => {
    const edited = updatedAt ? timeAgo(Date.parse(updatedAt)) : ""

    return (
        <div className="mb-1 mt-4 flex min-w-0 flex-wrap items-center gap-3.5">
            <ActiveToggle
                active={active}
                onToggle={onToggle}
                activatedMessage="Automation switched on"
                pausedMessage="Automation switched off"
                errorMessage="Couldn't change this automation"
            />
            <span className="text-[14px] font-medium text-foreground">{active ? "On" : "Off"}</span>
            <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                {agentName ? `Runs ${agentName}` : "No agent yet"}
                {edited ? ` · edited ${edited}` : ""}
            </span>
        </div>
    )
}
