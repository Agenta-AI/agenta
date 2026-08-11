import {
    TriggerDeliveriesDrawer,
    TriggerScheduleDrawer,
    TriggerSubscriptionDrawer,
} from "@agenta/entity-ui/gatewayTrigger"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"

export default function SessionAutomationDrawers() {
    const openSession = useOpenAgentSession()

    return (
        <>
            <TriggerScheduleDrawer />
            <TriggerSubscriptionDrawer />
            <TriggerDeliveriesDrawer
                onOpenSession={(sessionId, applicationId) => {
                    openSession({appId: applicationId, sessionId})
                }}
            />
        </>
    )
}
