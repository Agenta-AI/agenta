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
 * What to do with unsaved changes when the reader leaves the page.
 * Save keeps the page open and shows the commit step; the other two act at once.
 */
export const LeavePrompt = ({
    open,
    isNew,
    onSave,
    onCancel,
    onLeave,
}: {
    open: boolean
    /** A new test set has nothing to go back to, so it offers "Leave without saving". */
    isNew: boolean
    onSave: () => void
    onCancel: () => void
    onLeave: () => void
}) => (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
                <AlertDialogDescription>
                    You have unsaved changes in your test set. Do you want to save these changes
                    before leaving the page?
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <Button variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button variant="destructive" onClick={onLeave}>
                    {isNew ? "Leave without saving" : "Discard changes"}
                </Button>
                <Button onClick={onSave}>Save</Button>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
)
