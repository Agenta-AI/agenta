import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import duration from "dayjs/plugin/duration"
import relativeTime from "dayjs/plugin/relativeTime"

import {SubscriptionType} from "@/oss/services/billing/types"

dayjs.extend(duration)
dayjs.extend(relativeTime)

const SubscriptionPlanDetails = ({subscription}: {subscription: SubscriptionType}) => {
    if (!subscription) return null

    const end = dayjs.unix(subscription.period_end)
    const now = dayjs()

    const diffHumanized = dayjs.duration(end.diff(now)).humanize(true)

    const trialText = `trial ends ${diffHumanized}`

    return (
        <>
            {subscription?.plan?.split("_")[2]}{" "}
            <span className="lowercase">{subscription.free_trial ? trialText : ""}</span>
        </>
    )
}

export default SubscriptionPlanDetails
