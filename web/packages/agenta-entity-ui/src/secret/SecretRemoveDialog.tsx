import {useState} from "react"

import {useT} from "@agenta/i18n"
import agentSecretsCatalog from "@agenta/i18n/catalogs/entityUi.agentSecrets"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

/**
 * "Remove this secret attachment?" (F06 f3). Removing saves a new agent version without the
 * attachment; the secret stays in the vault. The dialog stays open with the reason when the
 * save fails.
 */
export const SecretRemoveDialog = ({
    onRemove,
    onClose,
}: {
    /** Saves the agent without the attachment. Throws with the reason when it fails. */
    onRemove: () => Promise<void>
    onClose: () => void
}) => {
    const t = useT(agentSecretsCatalog)
    const [removing, setRemoving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const remove = async () => {
        if (removing) return
        setRemoving(true)
        setError(null)
        try {
            await onRemove()
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : t("entityUi.agentSecrets.unableToRemove"),
            )
        } finally {
            setRemoving(false)
        }
    }
    return (
        <AlertDialog
            open
            onOpenChange={(next) => {
                if (!next && !removing) onClose()
            }}
        >
            <AlertDialogContent data-testid="secret-remove-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("entityUi.agentSecrets.removeAttachmentTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("entityUi.agentSecrets.removeAttachmentBody")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {error ? (
                    <div role="alert" className="text-sm text-colorError">
                        {error}
                    </div>
                ) : null}
                <AlertDialogFooter>
                    <Button variant="outline" disabled={removing} onClick={onClose}>
                        {t("entityUi.agentSecrets.cancel")}
                    </Button>
                    <Button variant="destructive" disabled={removing} onClick={() => void remove()}>
                        {removing
                            ? t("entityUi.agentSecrets.removing")
                            : t("entityUi.agentSecrets.remove")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
