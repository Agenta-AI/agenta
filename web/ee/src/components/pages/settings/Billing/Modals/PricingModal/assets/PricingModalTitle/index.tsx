import {memo} from "react"

import {Button, Typography} from "antd"

const PricingModalTitle = () => {
    return (
        <div className="w-full flex items-center justify-between">
            <Typography.Text className="text-[16px] font-[600]">Plans</Typography.Text>

            <Button className="mr-6" href="https://agenta.ai/pricing" target="_blank">
                View comparison
            </Button>
        </div>
    )
}

export default memo(PricingModalTitle)
