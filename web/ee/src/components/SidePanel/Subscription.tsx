import {useMemo} from "react"

import FreePlanBanner from "@/oss/components/Banners/BillingPlanBanner/FreePlanBanner"
import FreeTrialBanner from "@/oss/components/Banners/BillingPlanBanner/FreeTrialBanner"
import {isDemo} from "@/oss/lib/helpers/utils"
import {Plan} from "@/oss/lib/Types"
import {useSubscriptionData} from "@/oss/services/billing"

const SidePanelSubscription = () => {
    const {subscription} = useSubscriptionData()

    const isShowFreePlanBannerVisible = useMemo(
        () => isDemo() && !subscription?.free_trial && subscription?.plan === Plan.Hobby,
        [subscription],
    )
    const isShowFreeTrialBannerVisible = useMemo(
        () => isDemo() && subscription?.free_trial,
        [subscription],
    )

    return (
        <div className="w-[215px] shrink-0">
            {isShowFreePlanBannerVisible ? <FreePlanBanner /> : null}
            {isShowFreeTrialBannerVisible ? <FreeTrialBanner subscription={subscription} /> : null}
        </div>
    )
}

export default SidePanelSubscription
