import {Button, Typography} from "antd"
import {useRouter} from "next/router"
import useURL from "@/oss/hooks/useURL"

import {SubscriptionType} from "@/oss/services/billing/types"

import SubscriptionPlanDetails from "@/agenta-oss-common/components/pages/settings/Billing/Modals/PricingModal/assets/SubscriptionPlanDetails"

const FreeTrialBanner = ({subscription}: {subscription: SubscriptionType}) => {
    const router = useRouter()
    const {projectURL} = useURL()

    return (
        <section className="p-4 rounded-lg flex flex-col gap-1 bg-[#F5F7FA]">
            <Typography.Text className="text-base font-semibold capitalize">
                <SubscriptionPlanDetails subscription={subscription} />
            </Typography.Text>
            <Typography.Text className="text-[#586673]">
                Create unlimited applications & run unlimited evaluations. Upgrade today to keep pro
                plan features.
            </Typography.Text>
            <Button
                onClick={() => router.push(`${projectURL || ""}/settings?tab=billing`)}
                type="primary"
                className="self-start"
            >
                Upgrade now
            </Button>
        </section>
    )
}

export default FreeTrialBanner
