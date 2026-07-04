import {memo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"

const PricingModalTitle = () => {
    return (
        <div className="w-full flex items-center justify-between">
            <span className="text-base font-semibold">Plans</span>

            <Button
                variant="outline"
                className="mr-8"
                render={
                    <a href="https://agenta.ai/pricing" target="_blank" rel="noopener noreferrer" />
                }
            >
                View comparison
            </Button>
        </div>
    )
}

export default memo(PricingModalTitle)
