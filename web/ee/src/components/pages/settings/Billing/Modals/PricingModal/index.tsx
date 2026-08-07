import {EnhancedModal} from "@agenta/ui/components/modal"
import clsx from "clsx"
import dynamic from "next/dynamic"

import PricingModalTitle from "./assets/PricingModalTitle"
import {PricingModalProps} from "./assets/types"
const PricingModalContent = dynamic(() => import("./assets/PricingModalContent"), {ssr: false})

const PricingModal = ({onCancelSubscription, ...props}: PricingModalProps) => {
    return (
        <EnhancedModal
            className={clsx('[&_[data-slot="dialog-close-x"]]:!top-[19px]', props.className)}
            width={1200}
            title={<PricingModalTitle />}
            footer={null}
            {...props}
        >
            <PricingModalContent
                onCloseModal={() => props.onCancel?.({} as any)}
                onCancelSubscription={onCancelSubscription}
            />
        </EnhancedModal>
    )
}

export default PricingModal
