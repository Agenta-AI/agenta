import clsx from "clsx"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import PricingModalTitle from "./assets/PricingModalTitle"
import {PricingModalProps} from "./assets/types"
const PricingModalContent = dynamic(() => import("./assets/PricingModalContent"), {ssr: false})

const PricingModal = ({onCancelSubscription, ...props}: PricingModalProps) => {
    return (
        <EnhancedModal
            className={clsx("[&_.ant-modal-close]:top-[19px]", props.className)}
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
