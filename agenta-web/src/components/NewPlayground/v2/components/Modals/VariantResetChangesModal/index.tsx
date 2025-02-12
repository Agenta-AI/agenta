import {Modal, Typography} from "antd"
import {VariantResetChangesModalProps} from "./types"

const VariantResetChangesModal: React.FC<VariantResetChangesModalProps> = ({...props}) => {
    const onClose = (e: any) => {
        props.onCancel?.(e)
    }

    return (
        <Modal
            centered
            destroyOnClose
            okText="Reset"
            title="Reset changes"
            onCancel={onClose}
            {...props}
        >
            <div className="mt-4 mb-6 flex flex-col gap-2">
                <Typography.Text>Are you sure you want to reset all the changes?</Typography.Text>
                <Typography.Text>This action is not reversible.</Typography.Text>
            </div>
        </Modal>
    )
}

export default VariantResetChangesModal
