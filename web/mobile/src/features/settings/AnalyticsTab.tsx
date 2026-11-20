import {planRetention} from "@agenta/observability/analytics"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {AnalyticsPage} from "@agenta/observability-ui/analytics"
import {useBillingSubscription} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {LockedAgentChip} from "../agent-pages/LockedAgentChip"
import {useNewAgentAction} from "../agents/useNewAgentAction"

interface Props {
    workspaceId: string
    projectId: string
    /** The Analytics page of one agent: the Agent filter is locked to it. */
    lockedAgentId?: string
}

/** Mobile binding: plan retention, the upgrade link, agent creation and the trace drawer. */
export const AnalyticsTab = ({workspaceId, projectId, lockedAgentId}: Props) => {
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const billingEnabled = isBillingEnabled()
    const subscription = useBillingSubscription({projectId, enabled: billingEnabled})
    const newAgent = useNewAgentAction(base)
    const openTrace = useSetAtom(openTraceDrawerAtom)

    return (
        <AnalyticsPage
            retention={billingEnabled ? planRetention(subscription.data?.plan) : null}
            onUpgrade={
                !billingEnabled
                    ? undefined
                    : lockedAgentId
                      ? // The agent page is not in Settings: open the Billing tab there.
                        () => void router.push(`${base}/settings?tab=billing`)
                      : () =>
                            void router.replace(
                                {query: {...router.query, tab: "billing"}},
                                undefined,
                                {
                                    shallow: true,
                                },
                            )
            }
            lockedAgentId={lockedAgentId}
            lockedAgentChip={
                lockedAgentId ? <LockedAgentChip agentId={lockedAgentId} /> : undefined
            }
            onCreateAgent={() => void newAgent.create()}
            creatingAgent={newAgent.creating}
            createAgentError={newAgent.error}
            onOpenTrace={(traceId) => openTrace({traceId})}
        />
    )
}
