import {EnhancedModal} from "@agenta/ui"

import AddAppFromTemplateModalContent from "./components/AddAppFromTemplateModalContent"
import {AddAppFromTemplatedModalProps} from "./types"

const AddAppFromTemplatedModal = ({
    open,
    onCancel,
    handleTemplateCardClick,
}: AddAppFromTemplatedModalProps) => {
    return (
        <EnhancedModal open={open} onCancel={onCancel} footer={null} title={null} width={480}>
            <AddAppFromTemplateModalContent handleTemplateCardClick={handleTemplateCardClick} />
        </EnhancedModal>
    )
}

export default AddAppFromTemplatedModal
