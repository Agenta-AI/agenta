import {useEffect, useState} from "react"

import type {ChangesSummary, CommitPreview} from "@agenta/entities/testset"
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

// The diff view pulls in the editor. It loads only when the dialog has a preview to draw.
const DiffView = dynamic(() => import("@agenta/ui/editor").then((module) => module.DiffView), {
    ssr: false,
    loading: () => <Spinner className="mx-auto my-4" />,
})

type SummaryCounts = Pick<
    ChangesSummary,
    | "updatedTestcases"
    | "newTestcases"
    | "deletedTestcases"
    | "renamedColumns"
    | "addedColumns"
    | "deletedColumns"
>

const columnCount = (count: number, verb: string) =>
    count > 0 ? `${count} ${count === 1 ? "column" : "columns"} ${verb}` : null

/**
 * "2 modified, 1 added, 1 column renamed", leaving out a count of zero. Null when nothing
 * changed.
 */
export const changeText = (summary: SummaryCounts): string | null => {
    const parts = [
        summary.updatedTestcases > 0 ? `${summary.updatedTestcases} modified` : null,
        summary.newTestcases > 0 ? `${summary.newTestcases} added` : null,
        summary.deletedTestcases > 0 ? `${summary.deletedTestcases} deleted` : null,
        columnCount(summary.renamedColumns, "renamed"),
        columnCount(summary.addedColumns, "added"),
        columnCount(summary.deletedColumns, "deleted"),
    ].filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join(", ") : null
}

/**
 * The commit step: what will change, the next version and a message, and on the right a
 * preview of each changed row and column, as in the old app. A new test set has no version to
 * move from, so that line is left out.
 */
export const CommitTestsetDialog = ({
    open,
    isNew,
    currentVersion,
    latestVersion,
    summary,
    preview,
    pending,
    onClose,
    onCommit,
}: {
    open: boolean
    isNew: boolean
    currentVersion: number | undefined
    /** The highest saved version, or null until the revisions have loaded. */
    latestVersion: number | null
    summary: SummaryCounts
    preview: CommitPreview | null
    pending: boolean
    onClose: () => void
    onCommit: (commitMessage: string) => void
}) => {
    const [commitMessage, setCommitMessage] = useState("")
    useEffect(() => {
        if (open) setCommitMessage("")
    }, [open])

    const changes = changeText(summary)

    return (
        <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
            <DialogContent
                className={`max-h-[90vh] overflow-y-auto ${preview ? "sm:max-w-4xl" : "sm:max-w-xl"}`}
            >
                <DialogHeader>
                    <DialogTitle>Commit Changes</DialogTitle>
                    <DialogDescription>
                        This will create a new revision of your test set.
                    </DialogDescription>
                </DialogHeader>
                <div className={`flex flex-col gap-4 text-sm ${preview ? "md:flex-row" : ""}`}>
                    <div className={`flex flex-col gap-3 ${preview ? "md:w-80 md:shrink-0" : ""}`}>
                        {isNew ? null : (
                            <p className="m-0">
                                <span className="text-muted-foreground">Version </span>
                                <span className="font-medium">
                                    v{currentVersion ?? "#"}
                                    {latestVersion === null ? "" : ` → v${latestVersion + 1}`}
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
                    </div>
                    {preview ? (
                        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border">
                            <div className="flex items-center justify-between border-b px-3 py-2">
                                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Changes preview
                                </p>
                                <p className="m-0 text-xs text-muted-foreground">
                                    {preview.count} {preview.count === 1 ? "change" : "changes"}
                                </p>
                            </div>
                            <div className="max-h-80 overflow-auto">
                                <DiffView
                                    language="json"
                                    original={preview.original}
                                    modified={preview.modified}
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
