import {useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {BottomSheet, PHONE_BUTTON_CLASS, useIsPhone} from "@agenta/ui/phone"
import {Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from "@agenta/ui/ui"

import type {SecretOwner} from "./agentSecretRules"
import {SecretFormFields, useSecretFormSetup} from "./useSecretFormSetup"

export interface SecretFormDialogProps {
    /** The secret to edit; absent creates one. */
    secretId?: string
    /** The owners a new secret may take; more than one asks for the Owner. */
    owners?: readonly SecretOwner[]
    /** The dialog has closed: the host drops it. */
    onClosed: () => void
}

/** Create or edit a secret in a dialog, or a bottom sheet on a phone. */
export const SecretFormDialog = ({secretId, owners, onClosed}: SecretFormDialogProps) => {
    const t = useT(commonCatalog)
    const phone = useIsPhone()
    const [open, setOpen] = useState(true)
    const setup = useSecretFormSetup({secretId, owners})
    const close = () => setOpen(false)
    const save = async () => {
        if (await setup.save()) close()
    }
    const saveButton = (
        <Button
            className={phone ? PHONE_BUTTON_CLASS : undefined}
            disabled={!setup.valid}
            onClick={() => void save()}
        >
            {setup.saving ? t("common.saving") : (setup.saveLabel ?? t("common.save"))}
        </Button>
    )
    const fields = (
        <div className="flex flex-col gap-4 ph-no-capture">
            <SecretFormFields setup={setup} />
        </div>
    )

    if (phone) {
        return (
            <BottomSheet
                open={open}
                onOpenChange={(next) => (next ? undefined : close())}
                title={setup.title}
                showTitle
                actions={saveButton}
                onCloseAutoFocus={onClosed}
            >
                <div className="px-4">{fields}</div>
            </BottomSheet>
        )
    }
    return (
        <Dialog open={open} onOpenChange={(next) => (next || setup.saving ? undefined : close())}>
            <DialogContent onCloseAutoFocus={onClosed}>
                <DialogHeader>
                    <DialogTitle>{setup.title}</DialogTitle>
                </DialogHeader>
                {fields}
                <DialogFooter>
                    <Button variant="outline" disabled={setup.saving} onClick={close}>
                        {t("common.cancel")}
                    </Button>
                    {saveButton}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
