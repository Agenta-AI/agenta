import {EnhancedModal} from "@agenta/ui/components"

export function DriveEditGuardModal({
    open,
    displayPath,
    saving,
    onKeep,
    onDiscard,
}: {
    open: boolean
    displayPath: string
    saving: boolean
    onKeep: () => void
    onDiscard: () => void
}) {
    const name = displayPath.split("/").pop() || displayPath

    return (
        <EnhancedModal
            open={open}
            title="Discard unsaved changes?"
            onCancel={onKeep}
            onOk={onDiscard}
            cancelText="Keep editing"
            okText="Discard"
            closable={false}
            maskClosable={false}
            okButtonProps={{disabled: saving}}
            width={440}
        >
            <p className="m-0 text-sm text-colorTextSecondary">
                <span className="font-mono text-colorText">{name}</span> has changes that haven’t
                been saved. Leaving now discards them.
            </p>
        </EnhancedModal>
    )
}
