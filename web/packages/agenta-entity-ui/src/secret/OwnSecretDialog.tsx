/**
 * "Add one" and "Add another secret": the create fields of "Attach a secret", with "Only me"
 * fixed. The caller stores the choice with the new secret's id.
 */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import secretFormCatalog from "@agenta/i18n/catalogs/entityUi.secretForm"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"

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
    const t = useT(secretFormCatalog)
    const tCommon = useT(commonCatalog)
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
        // Contained runs non-modal: the host drawer already traps focus.
        <Dialog
            open={open}
            onOpenChange={(next) => !next && onClose()}
            modal={!container}
        >
            <DialogContent
                container={container ?? undefined}
                contained={!!container}
                className="max-w-[480px]"
                style={zIndex != null ? {zIndex} : undefined}
            >
                <DialogHeader>
                    <DialogTitle>{ACCOUNT_COPY.addYourSecret}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <SecretCreateFields
                        controller={controller}
                        focusValue={!!initialName?.trim()}
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>
                        {tCommon("common.cancel")}
                    </Button>
                    <LoadingButton
                        loading={controller.saving}
                        disabled={
                            !controller.name.trim() ||
                            !controller.textValue.trim() ||
                            controller.okDisabled
                        }
                        onClick={() => void controller.submit()}
                    >
                        {t("entityUi.secretForm.save")}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
