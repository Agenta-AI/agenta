/**
 * "Add one" and "Add another secret": the create fields of "Attach a secret", with "Only me"
 * fixed. The caller stores the choice with the new secret's id.
 */
import {EnhancedModal} from "@agenta/ui/components/modal"

import {ACCOUNT_COPY} from "../accounts/copy"

import {SecretCreateFields} from "./SecretCreateFields"
import {useSecretForm} from "./SecretForm"

export function OwnSecretDialog({
    open,
    onClose,
    onCreated,
    initialName,
    container,
    zIndex,
}: {
    open: boolean
    onClose: () => void
    onCreated: (secretId: string) => void
    initialName?: string
    container?: HTMLElement | null
    zIndex?: number
}) {
    const controller = useSecretForm({
        open,
        initialName,
        ownerKind: "user",
        onSaved: (secret) => {
            if (secret.id) onCreated(secret.id)
            onClose()
        },
    })
    return (
        <EnhancedModal
            open={open}
            onCancel={onClose}
            zIndex={zIndex}
            getContainer={container ?? undefined}
            contained={!!container}
            width={480}
            destroyOnClose
            title={ACCOUNT_COPY.addYourSecret}
            okText="Save"
            onOk={() => void controller.submit()}
            confirmLoading={controller.saving}
            okButtonProps={{
                disabled:
                    !controller.name.trim() ||
                    !controller.textValue.trim() ||
                    controller.okDisabled,
            }}
        >
            <div className="flex flex-col gap-4">
                <SecretCreateFields controller={controller} focusValue={!!initialName?.trim()} />
            </div>
        </EnhancedModal>
    )
}
