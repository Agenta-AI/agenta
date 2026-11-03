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

export interface KeepDraftRowsDialogProps {
    draftCount: number
    testsetName: string | null
    /** A chat playground loads one test case, so it can only replace the conversation. */
    chat: boolean
    onKeep: () => void
    onDiscard: () => void
    onCancel: () => void
}

/** Asks what happens to the draft test cases when a test set loads. */
export const KeepDraftRowsDialog = ({
    draftCount,
    testsetName,
    chat,
    onKeep,
    onDiscard,
    onCancel,
}: KeepDraftRowsDialogProps) => {
    const name = testsetName?.trim() || "the test set"
    const many = draftCount > 1
    return (
        <AlertDialog
            open
            onOpenChange={(next) => {
                if (!next) onCancel()
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {chat ? "Replace the current conversation?" : "Keep your draft test cases?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="flex flex-col gap-2">
                            {chat ? (
                                <>
                                    <p className="m-0">
                                        Loading {name} replaces the conversation in the playground.
                                    </p>
                                    <p className="m-0">
                                        The chat playground loads one test case at a time, so the
                                        conversation cannot be kept.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="m-0">
                                        {many
                                            ? `You have ${draftCount} draft test cases in the playground.`
                                            : "You have 1 draft test case in the playground."}
                                    </p>
                                    <p className="m-0">
                                        You can keep {many ? "them" : "it"} and load {name}{" "}
                                        alongside. Kept test cases stay unsaved until you sync
                                        changes back to the test set.
                                    </p>
                                </>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>
                    </AlertDialogCancel>
                    <Button variant="destructive" onClick={onDiscard}>
                        {chat ? "Load and replace" : "Discard drafts"}
                    </Button>
                    {chat ? null : <Button onClick={onKeep}>Keep and load</Button>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
