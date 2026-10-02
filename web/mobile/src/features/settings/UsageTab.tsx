import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {planRetention} from "@agenta/observability/usage"
import {UsagePage} from "@agenta/observability-ui/usage"
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
export const UsageTab = ({workspaceId, projectId}: Props) => {
    const router = useRouter()
    const billingEnabled = isBillingEnabled()
    const subscription = useBillingSubscription({projectId, enabled: billingEnabled})
    const newAgent = useNewAgentAction(`/w/${workspaceId}/p/${projectId}`)
    const openTrace = useSetAtom(openTraceDrawerAtom)

    return (
        <UsagePage
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
            onOpenTrace={(traceId) => openTrace({traceId})}
        />
    )
}
