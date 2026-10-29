import {type NamedSecretRow} from "@agenta/entities/secret"
import {SecretForm, useSecretForm} from "@agenta/entity-ui/secret"
import {EnhancedModal} from "@agenta/ui/components/modal"

interface ConfigureSecretModalProps {
    open: boolean
    selectedSecret: NamedSecretRow | null
    onCancel: () => void
}

const ConfigureSecretModal = ({open, selectedSecret, onCancel}: ConfigureSecretModalProps) => {
    const controller = useSecretForm({open, initialSecret: selectedSecret, onSaved: onCancel})

    return (
        <EnhancedModal
            open={open}
            title={controller.isEditing ? "Edit secret" : "Create secret"}
            okText="Save"
            okType="primary"
            onOk={controller.submit}
            confirmLoading={controller.saving}
            okButtonProps={{disabled: controller.okDisabled}}
            onCancel={onCancel}
        >
            <SecretForm controller={controller} />
        </EnhancedModal>
    )
}

export default ConfigureSecretModal
