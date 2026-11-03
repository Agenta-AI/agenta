import {useEffect, useState} from "react"

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

import {TestsetFileDrop} from "../create/TestsetFileDrop"
import {useTestsetFilePick} from "../create/useTestsetFilePick"

import {checkImportFile, type ImportFileCheck} from "./importFileCheck"
import {useImportRevision} from "./useImportRevision"

/**
 * Import a CSV or JSON file as a new revision of a saved test set. The file replaces every row.
 * The dialog uses the drop zone and the file checks of the create dialog, then reads the whole
 * file: a file with no rows is refused, and the current columns the file lacks are named.
 *
 * `currentColumns` are the column keys the grid shows. Closing resets the file; the dialog
 * stays open while the import runs.
 */
export const ImportRevisionDialog = ({
    open,
    projectId,
    testsetId,
    testsetName,
    currentColumns,
    onClose,
    onImported,
}: {
    open: boolean
    projectId: string
    testsetId: string
    testsetName: string
    currentColumns: string[]
    onClose: () => void
    onImported: (revisionId: string) => void
}) => {
    const picked = useTestsetFilePick()
    const {file, fileType} = picked
    // Null while the whole file is read.
    const [check, setCheck] = useState<ImportFileCheck | null>(null)
    const {importFile, pending, error, clearError} = useImportRevision({
        projectId,
        testsetId,
        onImported: (revisionId) => {
            close()
            if (revisionId) onImported(revisionId)
        },
    })

    useEffect(() => {
        setCheck(null)
        if (!file || !fileType) return
        let current = true
        void checkImportFile(file, fileType, currentColumns).then(
            (result) => current && setCheck(result),
        )
        return () => {
            current = false
        }
    }, [currentColumns, file, fileType])

    function close() {
        picked.remove()
        clearError()
        onClose()
    }

    const onFile = (chosen: File) => {
        // An error belongs to the file that caused it.
        clearError()
        void picked.pick(chosen)
    }
    const onRemove = () => {
        picked.remove()
        clearError()
    }

    const checking = file !== null && check === null
    const problem = error ?? (check && !check.ok ? check.message : null)
    const missing = check?.ok ? check.missingColumns : []
    const canImport = file !== null && fileType !== null && check?.ok === true && !pending

    return (
        <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : close())}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Import file as new revision</DialogTitle>
                    <DialogDescription>
                        Import a CSV or JSON file to replace the current data in &quot;
                        {testsetName}&quot;. This will create a new revision.
                    </DialogDescription>
                </DialogHeader>
                <div aria-busy={checking} className="flex min-w-0 flex-col gap-3">
                    <TestsetFileDrop
                        file={file}
                        preview={picked.rows}
                        error={picked.error}
                        disabled={pending}
                        onFile={onFile}
                        onRemove={onRemove}
                    />
                    {missing.length > 0 ? (
                        <p
                            data-testid="import-missing-columns"
                            className="m-0 text-xs text-muted-foreground"
                        >
                            These columns are not in the file and will not be in the new revision:{" "}
                            {missing.join(", ")}
                        </p>
                    ) : null}
                    {file && problem ? (
                        <p role="alert" className="m-0 text-xs text-destructive">
                            {problem}
                        </p>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={close} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!canImport}
                        onClick={() => {
                            if (canImport) void importFile({file, fileType})
                        }}
                    >
                        {pending ? <Spinner aria-hidden /> : null}
                        Import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
