import {planRetention} from "@agenta/observability/analytics"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {AnalyticsPage} from "@agenta/observability-ui/analytics"
import {useBillingSubscription} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useProjectData} from "@/oss/state/project"

/** Desktop binding for the shared Analytics page: plan retention, the upgrade link and the trace drawer. */
const Analytics = () => {
    const router = useRouter()
    const {projectId} = useProjectData()
    const billingEnabled = isBillingEnabled()
    const subscription = useBillingSubscription({projectId, enabled: billingEnabled})
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
                              {shallow: true},
                          )
                    : undefined
            }
            onOpenTrace={(traceId) => openTrace({traceId})}
        />
    )
}

export default Analytics
