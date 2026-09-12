import {AutomationDrawer} from "@agenta/automation-ui"
import {TriggerDeliveriesDrawer} from "@agenta/entity-ui/gatewayTrigger"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"

/**
 * The trigger drawers a session row's automation verbs open: one unified automation editor that
 * serves both schedules and event subscriptions, plus the deliveries drawer.
 */
export default function SessionAutomationDrawers() {
    const openSession = useOpenAgentSession()

    return (
        <>
            <AutomationDrawer />
            <TriggerDeliveriesDrawer
                onOpenSession={(sessionId, applicationId) => {
                    openSession({appId: applicationId, sessionId})
                }}
            />
        </>
    )
}
