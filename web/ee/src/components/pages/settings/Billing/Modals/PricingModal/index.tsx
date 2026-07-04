import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import dynamic from "next/dynamic"

import PricingModalTitle from "./assets/PricingModalTitle"
import {PricingModalProps} from "./assets/types"
const PricingModalContent = dynamic(() => import("./assets/PricingModalContent"), {ssr: false})

const PricingModal = ({open, onClose, onCancelSubscription}: PricingModalProps) => {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <DialogContent className="sm:max-w-[1200px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        <PricingModalTitle />
                    </DialogTitle>
                </DialogHeader>
                <PricingModalContent
                    onCloseModal={onClose}
                    onCancelSubscription={onCancelSubscription}
                />
            </DialogContent>
        </Dialog>
    )
}

export default PricingModal
