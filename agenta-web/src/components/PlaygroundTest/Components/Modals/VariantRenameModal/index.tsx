import {useState} from "react"
import {Input, Modal} from "antd"
import {Check} from "@phosphor-icons/react"
import {VariantRenameModalProps} from "./types"

const VariantRenameModal: React.FC<VariantRenameModalProps> = ({...props}) => {
    const [rename, setRename] = useState("")

    const onClose = (e: any) => {
        props.onCancel?.(e)
    }

    return (
        <Modal
            centered
            destroyOnClose
            onCancel={onClose}
            title="Rename variant"
            okText={
                <div className="flex items-center gap-1">
                    <Check size={14} className="-mb-[3px]" /> Confirm
                </div>
            }
            {...props}
        >
            <div className="mt-4 mb-6">
                <Input
                    placeholder="Input"
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                />
            </div>
        </Modal>
    )
}

export default VariantRenameModal
