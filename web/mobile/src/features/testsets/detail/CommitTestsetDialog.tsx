import {useEffect, useState} from "react"

import type {ChangesSummary} from "@agenta/entities/testset"
import {CommitMessageInput} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner,
} from "@agenta/ui/ui"
import dynamic from "next/dynamic"

import type {ChangesDiff} from "./changesDiff"

// The diff view pulls in the editor. It loads only when the dialog has a preview to draw.
const DiffView = dynamic(() => import("@agenta/ui/editor").then((module) => module.DiffView), {
    ssr: false,
    loading: () => <Spinner className="mx-auto my-4" />,
})

/** "2 modified, 1 added", leaving out a count of zero. Null when no row changed. */
export const rowChangeText = (
    summary: Pick<ChangesSummary, "updatedTestcases" | "newTestcases" | "deletedTestcases">,
): string | null => {
    const parts = [
        summary.updatedTestcases > 0 ? `${summary.updatedTestcases} modified` : null,
        summary.newTestcases > 0 ? `${summary.newTestcases} added` : null,
        summary.deletedTestcases > 0 ? `${summary.deletedTestcases} deleted` : null,
    ].filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join(", ") : null
}

/**
 * The commit step: what will change, the next version and a message. A new test set has no
 * version to move from, so that line is left out.
 */
export const CommitTestsetDialog = ({
    open,
    isNew,
    currentVersion,
    latestVersion,
    summary,
    diff,
    pending,
    onClose,
    onCommit,
}: {
    open: boolean
    isNew: boolean
    currentVersion: number | undefined
    /** The highest saved version. The commit becomes the one after it. */
    latestVersion: number
    summary: Pick<ChangesSummary, "updatedTestcases" | "newTestcases" | "deletedTestcases">
    diff: ChangesDiff | null
    pending: boolean
    onClose: () => void
    onCommit: (commitMessage: string) => void
}) => {
    const [commitMessage, setCommitMessage] = useState("")
    useEffect(() => {
        if (open) setCommitMessage("")
    }, [open])

    const changes = rowChangeText(summary)

    return (
        <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Commit Changes</DialogTitle>
                    <DialogDescription>
                        This will create a new revision of your test set.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm">
                    {isNew ? null : (
                        <p className="m-0">
                            <span className="text-muted-foreground">Version </span>
                            <span className="font-medium">
                                v{currentVersion ?? "#"} → v{latestVersion + 1}
                            </span>
                        </p>
                    )}
                    {changes ? (
                        <p className="m-0">
                            <span className="text-muted-foreground">Changes: </span>
                            {changes}
                        </p>
                    ) : null}
                    <CommitMessageInput
                        label="Commit message"
                        showOptional={false}
                        placeholder="Describe what changed in this revision..."
                        value={commitMessage}
                        onChange={setCommitMessage}
                        disabled={pending}
                    />
                    {diff ? (
                        <div className="flex flex-col gap-1.5">
                            <p className="m-0 text-xs font-medium text-muted-foreground">
                                Changes preview ({diff.count}{" "}
                                {diff.count === 1 ? "change" : "changes"})
                            </p>
                            <div className="max-h-64 overflow-auto rounded-md border">
                                <DiffView
                                    language="json"
                                    original={diff.original}
                                    modified={diff.modified}
                                    enableFolding
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button disabled={pending} onClick={() => onCommit(commitMessage)}>
                        {pending ? <Spinner aria-hidden /> : null}
                        Commit
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
