import {Input, Modal, Typography} from "antd"
import {FloppyDiskBack} from "@phosphor-icons/react"
import {CommitVariantChangesModalProps} from "./types"

const {Text} = Typography

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({...props}) => {
    const variantName = "app.v6"

    const onClose = (e: any) => {
        props.onCancel?.(e)
    }

    return (
        <Modal
            centered
            destroyOnClose
            title="Commit changes"
            onCancel={onClose}
            okText={
                <div className="flex items-center gap-1">
                    <FloppyDiskBack size={14} className="-mb-[3px]" /> Commit
                </div>
            }
            {...props}
        >
            <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Text>You are about to new version</Text>

                    <Text>{variantName}</Text>
                </div>
                <div className="flex flex-col gap-1">
                    <Text>Notes (optional)</Text>
                    <Input.TextArea
                        placeholder="Describe the changes that you have done for this version"
                        className="w-full"
                    />
                </div>
            </section>
        </Modal>
    )
}

export default CommitVariantChangesModal
