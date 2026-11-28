/** The one confirm before an item leaves the agent; red only here (ACT-03). */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    LoadingButton,
} from "@agenta/ui/ui"

export interface RemoveFromAgentDialogProps {
    open: boolean
    /** The item's name, as its row shows it. */
    name: string
    /** What stays after the remove ("The connection stays in the project."). */
    body: ReactNode
    /** The remove is saving: both buttons wait, and the dialog stays open. */
    pending?: boolean
    /** Why the last remove failed; the dialog stays open with it. */
    error?: string | null
    onConfirm: () => void
    onCancel: () => void
}

export function RemoveFromAgentDialog({
    open,
    name,
    body,
    pending = false,
    error,
    onConfirm,
    onCancel,
}: RemoveFromAgentDialogProps) {
    const t = useT(integrationViewsCatalog, commonCatalog)
    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onCancel()
            }}
        >
            <AlertDialogContent data-testid="remove-from-agent-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("entityUi.integrationViews.removeTitle", {name})}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{body}</AlertDialogDescription>
                </AlertDialogHeader>
                {error ? (
                    <div role="alert" className="text-label text-destructive">
                        {error}
                    </div>
                ) : null}
                <AlertDialogFooter>
                    <Button variant="outline" disabled={pending} onClick={onCancel}>
                        {t("common.cancel")}
                    </Button>
                    <LoadingButton variant="destructive" loading={pending} onClick={onConfirm}>
                        {t("common.remove")}
                    </LoadingButton>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
