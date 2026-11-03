import {useCallback, useEffect, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Button, SimpleTooltip, Spinner} from "@agenta/ui/ui"
import {ArrowCounterClockwise, Plus, UploadSimple} from "@phosphor-icons/react"

import {ConfirmModal} from "../../settings/ConfirmModal"

import {useChangesDiff} from "./changesDiff"
import {CommitTestsetDialog} from "./CommitTestsetDialog"
import {testsetRevisionPath} from "./testsetRouteId"
import type {RevisionsList} from "./useRevisionsList"
import type {TestsetEditor} from "./useTestsetEditor"
import {useTestsetLeaveGuard} from "./useTestsetLeaveGuard"

type ToolbarEditor = Pick<
    TestsetEditor,
    | "isNew"
    | "header"
    | "hasUnsavedChanges"
    | "changesSummary"
    | "isSaving"
    | "addRow"
    | "discard"
    | "commit"
>

/**
 * The buttons above the grid, and the three steps they lead to: the commit dialog, the discard
 * confirm and the prompt for leaving with unsaved changes. A reader who may not edit gets none
 * of it: no buttons, and no prompt because nothing can be unsaved.
 *
 * `onImport` is optional: the Import button shows only when the page can open the import step.
 * `onRowAdded` lets the page open the new row in the drawer. The page holds `commitOpen`, so
 * the testcase drawer can open the same commit step.
 */
export const TestsetToolbar = ({
    editor,
    routeId,
    base,
    canEdit,
    revisions,
    onImport,
    onRowAdded,
    commitOpen,
    onCommitOpenChange: setCommitOpen,
}: {
    editor: ToolbarEditor
    routeId: string
    /** `/w/{workspace}/p/{project}`, the start of every test set path. */
    base: string
    canEdit: boolean
    revisions: Pick<RevisionsList, "latestVersion" | "load" | "status">
    onImport?: () => void
    onRowAdded?: (rowId: string) => void
    commitOpen: boolean
    onCommitOpenChange: (open: boolean) => void
}) => {
    const {isNew, hasUnsavedChanges, isSaving} = editor
    const [discardOpen, setDiscardOpen] = useState(false)

    const guard = useTestsetLeaveGuard({
        dirty: canEdit && hasUnsavedChanges,
        isNew,
        onSave: () => setCommitOpen(true),
        onDiscard: editor.discard,
    })

    // The next version needs the saved revisions, so the list loads when the step opens.
    const {load: loadRevisions} = revisions
    useEffect(() => {
        if (commitOpen) loadRevisions()
    }, [commitOpen, loadRevisions])
    const diff = useChangesDiff(routeId, commitOpen)

    const handleCommit = useCallback(
        async (commitMessage: string) => {
            const revisionId = await editor.commit(commitMessage)
            if (!revisionId) return
            setCommitOpen(false)
            guard.leave(testsetRevisionPath(base, revisionId))
        },
        [base, editor, guard, setCommitOpen],
    )

    const handleAddRow = useCallback(() => {
        const rowId = editor.addRow()
        if (rowId) onRowAdded?.(rowId)
    }, [editor, onRowAdded])

    const confirmDiscard = useCallback(() => {
        editor.discard()
        setDiscardOpen(false)
        message.success("Changes discarded")
    }, [editor])

    return (
        <>
            {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                    {hasUnsavedChanges ? (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={isNew || isSaving}
                            onClick={() => setDiscardOpen(true)}
                        >
                            <ArrowCounterClockwise aria-hidden size={14} />
                            Discard
                        </Button>
                    ) : null}
                    {onImport ? (
                        <SimpleTooltip title="Import CSV/JSON file as new revision">
                            <span className="inline-flex">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isNew || isSaving}
                                    onClick={onImport}
                                >
                                    <UploadSimple aria-hidden size={14} />
                                    Import
                                </Button>
                            </span>
                        </SimpleTooltip>
                    ) : null}
                    <Button variant="outline" size="sm" disabled={isSaving} onClick={handleAddRow}>
                        <Plus aria-hidden size={14} />
                        Add row
                    </Button>
                    <Button
                        size="sm"
                        disabled={!hasUnsavedChanges || isSaving}
                        onClick={() => setCommitOpen(true)}
                    >
                        {isSaving ? <Spinner aria-hidden /> : null}
                        Commit
                    </Button>
                </div>
            ) : null}
            <CommitTestsetDialog
                open={commitOpen}
                isNew={isNew}
                currentVersion={editor.header?.revisionVersion}
                latestVersion={revisions.status === "ready" ? revisions.latestVersion : null}
                summary={editor.changesSummary}
                diff={diff}
                pending={isSaving}
                onClose={() => setCommitOpen(false)}
                onCommit={(commitMessage) => void handleCommit(commitMessage)}
            />
            <ConfirmModal
                open={discardOpen}
                title="Discard changes?"
                description="Are you sure you want to discard all unsaved changes?"
                confirmLabel="Discard"
                onClose={() => setDiscardOpen(false)}
                onConfirm={confirmDiscard}
            />
            {guard.prompt}
        </>
    )
}
