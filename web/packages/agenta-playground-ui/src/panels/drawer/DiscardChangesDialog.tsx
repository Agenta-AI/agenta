import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

/** Asks before the drawer closes or shows another revision while it has unsaved edits. */
export const DiscardChangesDialog = ({
    open,
    onDiscard,
    onCancel,
}: {
    open: boolean
    onDiscard: () => void
    onCancel: () => void
}) => (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription>
                    This revision has changes that are not committed. They will be lost.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel asChild>
                    <Button variant="outline">Keep editing</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                    <Button variant="destructive" onClick={onDiscard}>
                        Discard
                    </Button>
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
)
