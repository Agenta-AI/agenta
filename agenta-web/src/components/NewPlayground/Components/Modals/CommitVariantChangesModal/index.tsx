import {useCallback, useState} from "react"
import {Input, Modal, Typography} from "antd"
import {FloppyDiskBack} from "@phosphor-icons/react"
import {CommitVariantChangesModalProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const {Text} = Typography

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    ...props
}) => {
    const {variant, saveVariant} = usePlayground({
        variantId,
        hookId: "CommitVariantChangesModal",
    })
    const [note, setNote] = useState("")

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
    }, [])

    // TODO: add loading state here
    const onSaveVariantChnages = useCallback(async () => {
        await saveVariant?.()
        onClose()
    }, [])

    return (
        <Modal
            centered
            destroyOnClose
            title="Commit changes"
            onCancel={onClose}
            okText="Commit"
            onOk={onSaveVariantChnages}
            okButtonProps={{icon: <FloppyDiskBack size={14} />}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Text>You are about to new version</Text>

                    <Text>{variant?.variantName}</Text>
                </div>
                <div className="flex flex-col gap-1">
                    <Text>Notes (optional)</Text>
                    <Input.TextArea
                        placeholder="Describe the changes that you have done for this version"
                        className="w-full"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                </div>
            </section>
        </Modal>
    )
}

export default CommitVariantChangesModal
