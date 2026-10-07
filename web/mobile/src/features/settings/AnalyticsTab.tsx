import {planRetention} from "@agenta/observability/analytics"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {AnalyticsPage} from "@agenta/observability-ui/analytics"
import {useBillingSubscription} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useNewAgentAction} from "../agents/useNewAgentAction"

interface Props {
    workspaceId: string
    projectId: string
}

/** Mobile binding: plan retention, the upgrade link, agent creation and the trace drawer. */
export const AnalyticsTab = ({workspaceId, projectId}: Props) => {
    const router = useRouter()
    const billingEnabled = isBillingEnabled()
    const subscription = useBillingSubscription({projectId, enabled: billingEnabled})
    const newAgent = useNewAgentAction(`/w/${workspaceId}/p/${projectId}`)
    const openTrace = useSetAtom(openTraceDrawerAtom)

    return (
        <AnalyticsPage
            retention={billingEnabled ? planRetention(subscription.data?.plan) : null}
            onUpgrade={
                billingEnabled
                    ? () =>
                          void router.replace(
                              {query: {...router.query, tab: "billing"}},
                              undefined,
                              {
                                  shallow: true,
                              },
                          )
                    : undefined
            }
            onCreateAgent={() => void newAgent.create()}
            creatingAgent={newAgent.creating}
            createAgentError={newAgent.error}
            onOpenTrace={(traceId) => openTrace({traceId})}
        />
    )
}
