import {useT} from "@agenta/i18n"
import testsetsCatalog from "@agenta/i18n/catalogs/playground.testsets"
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

export interface UnsavedTestsetDialogProps {
    /** What the user asked for: disconnect, or load a different test set. */
    intent: "disconnect" | "change"
    /** A save is in flight: nothing closes the dialog. */
    saving: boolean
    onSave: () => void
    onDiscard: () => void
    onCancel: () => void
}

const COPY = {
    disconnect: {
        title: "playground.testsets.disconnectTitle",
        question: "playground.testsets.disconnectQuestion",
        note: "playground.testsets.disconnectNote",
        discard: "playground.testsets.disconnectDiscard",
        save: "playground.testsets.disconnectSave",
    },
    change: {
        title: "playground.testsets.changeTitle",
        question: "playground.testsets.changeQuestion",
        note: "playground.testsets.changeNote",
        discard: "playground.testsets.changeDiscard",
        save: "playground.testsets.changeSave",
    },
} as const

/** Asks whether to save the test set edits before the playground leaves the test set. */
export const UnsavedTestsetDialog = ({
    intent,
    saving,
    onSave,
    onDiscard,
    onCancel,
}: UnsavedTestsetDialogProps) => {
    const t = useT(testsetsCatalog)
    const copy = COPY[intent]
    return (
        <AlertDialog
            open
            onOpenChange={(next) => {
                if (!next && !saving) onCancel()
            }}
        >
            <AlertDialogContent
                // Three actions with long labels need more than the default width.
                className="max-w-lg"
                onEscapeKeyDown={(event) => {
                    if (saving) event.preventDefault()
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="flex flex-col gap-2">
                            <p className="m-0">{t(copy.question)}</p>
                            <p className="m-0">{t(copy.note)}</p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onCancel} disabled={saving}>
                            {t("playground.testsets.cancel")}
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" onClick={onDiscard} disabled={saving}>
                        {t(copy.discard)}
                    </Button>
                    <Button onClick={onSave} disabled={saving}>
                        {t(copy.save)}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
