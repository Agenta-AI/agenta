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

    const isFuture = end.isAfter(now)
    const diffHumanized = dayjs.duration(Math.abs(end.diff(now))).humanize(false)
    const trialText = subscription.free_trial
        ? isFuture
            ? `trial ends in ${diffHumanized}`
            : `trial ended ${diffHumanized} ago`
        : ""
    return (
        <>
            {subscription?.plan?.split("_")[2]}{" "}
            <span className="lowercase">{subscription.free_trial ? trialText : ""}</span>
        </>
    )
}

export default SubscriptionPlanDetails
