import {useCallback, useState} from "react"
import {Input, Modal} from "antd"
import {Check} from "@phosphor-icons/react"
import {VariantRenameModalProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const VariantRenameModal: React.FC<VariantRenameModalProps> = ({variantId, ...props}) => {
    const [rename, setRename] = useState("")
    const {mutateVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
    })

    const onClose = () => {
        props.onCancel?.({} as any)
    }

    const onRenameVariant = useCallback(() => {}, [])

    return (
        <Modal
            centered
            destroyOnClose
            okText="Confirm"
            onCancel={onClose}
            onOk={onRenameVariant}
            title="Rename variant"
            okButtonProps={{icon: <Check size={14} />}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <div className="mt-4 mb-6">
                <Input
                    addonBefore="app."
                    placeholder="Type variant name..."
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                />
            </div>
        </Modal>
    )
}

export default VariantRenameModal
