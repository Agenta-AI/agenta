import {useState} from "react"

import {useT} from "@agenta/i18n"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

/**
 * "Delete this automation?" (F06 f4). The automation stops and leaves the list; its past runs
 * stay. While the delete runs the buttons wait; when it fails the dialog says so in plain words
 * and stays open, and the automation stays.
 */
export const AutomationDeleteDialog = ({
    open,
    name,
    onDelete,
    onClose,
}: {
    open: boolean
    name: string
    /** Deletes the automation. Throws when the delete failed. */
    onDelete: () => Promise<void>
    onClose: () => void
}) => {
    const t = useT(automationsScreensCatalog, automationsPanelCatalog)
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)

    const close = () => {
        if (pending) return
        setFailed(false)
        onClose()
    }
    const remove = async () => {
        setPending(true)
        setFailed(false)
        try {
            await onDelete()
            setPending(false)
            onClose()
        } catch (error) {
            console.error("[AutomationDeleteDialog] delete failed", error)
            setPending(false)
            setFailed(true)
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
            <AlertDialogContent data-testid="automation-delete-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("automations.screens.deleteTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("automations.screens.deleteMessage", {name})}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {failed ? (
                    <p role="alert" className="m-0 text-[13px] text-destructive">
                        {t("automations.panel.deleteFailed")}
                    </p>
                ) : null}
                <AlertDialogFooter>
                    {/* The dialog's Cancel primitive: focus starts on it when the dialog opens. */}
                    <AlertDialogCancel asChild>
                        <Button variant="outline" disabled={pending}>
                            {t("automations.screens.cancel")}
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
                        {t("automations.screens.delete")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
