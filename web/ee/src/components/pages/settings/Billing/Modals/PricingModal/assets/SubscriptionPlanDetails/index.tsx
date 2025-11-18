import dayjs from "dayjs"

import {SubscriptionType} from "@/oss/services/billing/types"

const SubscriptionPlanDetails = ({subscription}: {subscription: SubscriptionType}) => {
    return (
        <>
            {subscription?.plan?.split("_")[2]}{" "}
            <span className="lowercase">
                {subscription.free_trial
                    ? `trial ends in ${dayjs.unix(subscription.period_end).diff(dayjs(), "day")} ${
                          dayjs.unix(subscription.period_end).diff(dayjs(), "day") === 1
                              ? "day"
                              : "days"
                      }`
                    : ""}
            </span>
        </>
    )
}

export default SubscriptionPlanDetails
