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
        title: "Save changes?",
        question:
            "You have unsaved changes. Do you want to save them before disconnecting the test set?",
        note: "Unsaved test cases will convert into local test cases.",
        discard: "Discard & disconnect",
        save: "Save & disconnect",
    },
    change: {
        title: "Load different test set?",
        question:
            "You have unsaved changes. Do you want to save them before loading a different test set?",
        note: "Loading test cases from a different test set will remove any previously loaded test cases.",
        discard: "Discard & Load",
        save: "Save & load",
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
    const copy = COPY[intent]
    return (
        <AlertDialog
            open
            onOpenChange={(next) => {
                if (!next && !saving) onCancel()
            }}
        >
            <AlertDialogContent
                onEscapeKeyDown={(event) => {
                    if (saving) event.preventDefault()
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{copy.title}</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="flex flex-col gap-2">
                            <p className="m-0">{copy.question}</p>
                            <p className="m-0">{copy.note}</p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onCancel} disabled={saving}>
                            Cancel
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" onClick={onDiscard} disabled={saving}>
                        {copy.discard}
                    </Button>
                    <Button onClick={onSave} disabled={saving}>
                        {copy.save}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
