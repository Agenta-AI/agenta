import {useT} from "@agenta/i18n"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"

import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../components/ui/alert-dialog"
import {Button} from "../components/ui/button"

export type LeaveAnswer = "keep" | "discard" | "save"

/**
 * The one generic unsaved-changes dialog. The description comes from the dirty view, because
 * Save writes different places. Domain dialogs live in their domain packages.
 */
export const UnsavedChangesDialog = ({
    open,
    description,
    canSave,
    saveFailed = false,
    onAnswer,
}: {
    open: boolean
    description: string
    /** False when the edits are not valid: "Save changes" is disabled. */
    canSave: boolean
    /** The last "Save changes" failed: the edits are still there, and the person can try again. */
    saveFailed?: boolean
    onAnswer: (answer: LeaveAnswer) => void
}) => {
    const t = useT(viewStackCatalog)
    return (
        <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onAnswer("keep"))}>
            <AlertDialogContent data-testid="unsaved-changes-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("ui.viewStack.unsavedChanges")}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                    {saveFailed ? (
                        <span role="alert" className="text-sm text-colorError">
                            {t("ui.viewStack.saveFailed")}
                        </span>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={() => onAnswer("keep")}>
                        {t("ui.viewStack.keepEditing")}
                    </Button>
                    <Button variant="destructive-outline" onClick={() => onAnswer("discard")}>
                        {t("ui.viewStack.discard")}
                    </Button>
                    <Button disabled={!canSave} onClick={() => onAnswer("save")}>
                        {t("ui.viewStack.saveChanges")}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
