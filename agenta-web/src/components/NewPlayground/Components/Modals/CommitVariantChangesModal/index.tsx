import {useCallback, useState} from "react"
import {Input, Modal, Typography} from "antd"
import {ArrowRight, FloppyDiskBack} from "@phosphor-icons/react"
import {CommitVariantChangesModalProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {useStyles} from "./styles"
import Version from "@/components/NewPlayground/assets/Version"

const {Text} = Typography

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    ...props
}) => {
    const classes = useStyles()
    const {variant, saveVariant} = usePlayground({
        variantId,
        hookId: "CommitVariantChangesModal",
    })

    const [note, setNote] = useState("")

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
    }, [])

    const onSaveVariantChanges = useCallback(async () => {
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
            confirmLoading={variant?.__isMutating}
            onOk={onSaveVariantChanges}
            okButtonProps={{icon: <FloppyDiskBack size={14} />}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Text>You are about to create a new version:</Text>

                    <div className="flex items-center gap-2">
                        <Text className={classes.heading}>{variant?.variantName}</Text>
                        <div className="flex items-center gap-[6px]">
                            <Version className="!m-0" revision={variant?.revision as number} />
                            <ArrowRight size={14} />
                            <Version
                                className="!m-0"
                                revision={(variant?.revision as number) + 1}
                            />
                        </div>
                    </div>
                </div>
                {/* <div className="flex flex-col gap-1">
                    <Text>Notes (optional)</Text>
                    <Input.TextArea
                        placeholder="Describe the changes that you have done for this version"
                        className="w-full"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                </div> */}
            </section>
        </Modal>
    )
}

export default CommitVariantChangesModal
