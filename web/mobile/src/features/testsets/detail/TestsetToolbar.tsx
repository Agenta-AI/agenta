import {useCallback, useEffect, useState} from "react"

import {commitPreviewAtom} from "@agenta/entities/testset"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import testsetScreensCatalog from "@agenta/i18n/catalogs/testsets.screens"
import {message} from "@agenta/ui/app-message"
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
    SimpleTooltip,
    Spinner,
} from "@agenta/ui/ui"
import {ArrowCounterClockwise, Plus, UploadSimple} from "@phosphor-icons/react"
import {atom, useAtomValue} from "jotai"

import {CommitTestsetDialog} from "./CommitTestsetDialog"
import {TestcaseQueueButton} from "./TestcaseQueuePicker"
import {testsetRevisionPath} from "./testsetRouteId"
import type {RevisionsList} from "./useRevisionsList"
import type {TestsetEditor} from "./useTestsetEditor"
import {useTestsetLeaveGuard} from "./useTestsetLeaveGuard"

// The preview reads every row edit, so it is read only while the commit step is open.
const NO_PREVIEW = atom(null)

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
 * Import saves a new revision and opens it; unsaved changes then meet the leave prompt.
 * `onRowAdded` lets the page open the new row in the drawer. The page holds `commitOpen`, so
 * the testcase drawer can open the same commit step.
 */
export const TestsetToolbar = ({
    editor,
    base,
    canEdit,
    revisions,
    onImport,
    onRowAdded,
    queueItemIds = [],
    commitOpen,
    onCommitOpenChange: setCommitOpen,
}: {
    editor: ToolbarEditor
    /** `/w/{workspace}/p/{project}`, the start of every test set path. */
    base: string
    canEdit: boolean
    revisions: Pick<RevisionsList, "latestVersion" | "load" | "status">
    onImport?: () => void
    onRowAdded?: (rowId: string) => void
    /**
     * The saved test cases "Add to queue" sends: the selected ones, or every one the
     * grid shows. Empty turns the button off.
     */
    queueItemIds?: string[]
    commitOpen: boolean
    onCommitOpenChange: (open: boolean) => void
}) => {
    const t = useT(testsetScreensCatalog, commonCatalog)
    const {isNew, hasUnsavedChanges, isSaving} = editor
    const [discardOpen, setDiscardOpen] = useState(false)

    const guard = useTestsetLeaveGuard({
        dirty: canEdit && hasUnsavedChanges,
        onSave: () => setCommitOpen(true),
        onDiscard: editor.discard,
    })

    // The next version needs the saved revisions, so the list loads when the step opens.
    const {load: loadRevisions} = revisions
    useEffect(() => {
        if (commitOpen) loadRevisions()
    }, [commitOpen, loadRevisions])
    const preview = useAtomValue(commitOpen ? commitPreviewAtom : NO_PREVIEW)

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
                    <TestcaseQueueButton
                        label={t("testsets.screens.addToQueue")}
                        itemIds={queueItemIds}
                        disabled={isNew || isSaving}
                    />
                    <Button
                        size="sm"
                        // Outlined while there is nothing to commit, as in the old app: a filled
                        // grey button reads as active.
                        variant={hasUnsavedChanges ? "default" : "outline"}
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
                preview={preview}
                pending={isSaving}
                onClose={() => setCommitOpen(false)}
                onCommit={(commitMessage) => void handleCommit(commitMessage)}
            />
            <AlertDialog
                open={discardOpen}
                onOpenChange={(next) => {
                    if (!next) setDiscardOpen(false)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to discard all unsaved changes?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                onClick={(event) => {
                                    event.preventDefault()
                                    confirmDiscard()
                                }}
                            >
                                Discard
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog
                open={guard.promptOpen}
                onOpenChange={(next) => (next ? undefined : guard.cancelLeave())}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
                        <AlertDialogDescription>
                            You have unsaved changes in your test set. Do you want to save these
                            changes before leaving the page?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={guard.cancelLeave}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={guard.discardAndLeave}>
                            {isNew ? "Leave without saving" : "Discard changes"}
                        </Button>
                        <Button onClick={guard.saveInstead}>Save</Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
