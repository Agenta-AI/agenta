import {RegionInfoText} from "@agenta/auth-ui"
import {EnhancedModal, ModalContent} from "@agenta/ui"

interface RegionInfoModalProps {
    open: boolean
    onClose: () => void
}

const RegionInfoModal = ({open, onClose}: RegionInfoModalProps) => {
    return (
        <EnhancedModal title="Data Regions" open={open} onCancel={onClose} footer={null}>
            <ModalContent>
                <RegionInfoText className="text-sm text-colorTextSecondary" />
            </ModalContent>
        </EnhancedModal>
    )
}

export default RegionInfoModal
