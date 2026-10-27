import {SimpleTooltip} from "@agenta/ui/ui"
import {LockSimpleIcon} from "@phosphor-icons/react"

import {sharingCopy} from "@/lib/sharingCopy"

/**
 * The lock after an agent's name that marks the reader's own private agent, the same mark a
 * private chat carries in the session list. No marker = shared with the project.
 */
export const AgentPrivateMarker = () => (
    <SimpleTooltip title={sharingCopy.agentPrivateMarker}>
        <span
            className="inline-flex shrink-0 items-center text-muted-foreground"
            data-testid="agent-private-marker"
        >
            <LockSimpleIcon size={12} aria-label={sharingCopy.agentPrivateMarker} />
        </span>
    </SimpleTooltip>
)
