import {useMemo, useState} from "react"

import {
    EntityPicker,
    testsetAdapter,
    type TestsetSelectionResult,
} from "@agenta/entity-ui/selection"
import {TestcaseTable} from "@agenta/entity-ui/testcase"
import {useMediaQuery} from "@agenta/ui/hooks"
import {
    Alert,
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
} from "@agenta/ui/ui"
import {CaretLeft, MagnifyingGlass, Plus} from "@phosphor-icons/react"

import {useTestsetLoadSelection} from "../../hooks/useTestsetLoadSelection"
import type {TestsetLoadPayload} from "../../hooks/useTestsetMenuModel"

export interface LoadTestsetDialogProps {
    loadableId: string
    /** "load" connects a test set; "edit" changes the rows of the connected one. */
    mode: "load" | "edit"
    connectedRevisionId: string | null
    connectedTestsetId: string | null
    /** A chat playground loads one test case at a time. */
    singleSelect: boolean
    /** The picked rows. In edit mode only the revision and the row ids matter. */
    onConfirm: (payload: TestsetLoadPayload) => void
    onCancel: () => void
    /** Opens the way to make a new test set. Load mode only: managing rows has no use for it. */
    onCreate?: () => void
}

/**
 * Picks a test set revision and its rows. Wide screens show the test sets beside the rows; a
 * phone shows the test sets first, then the rows with a way back.
 */
export const LoadTestsetDialog = ({
    loadableId,
    mode,
    connectedRevisionId,
    connectedTestsetId,
    singleSelect,
    onConfirm,
    onCancel,
    onCreate,
}: LoadTestsetDialogProps) => {
    const wide = useMediaQuery("(min-width: 768px)")
    const isEdit = mode === "edit"
    const [step, setStep] = useState<"sets" | "rows">(isEdit ? "rows" : "sets")
    const [searchTerm, setSearchTerm] = useState("")
    const selection = useTestsetLoadSelection({
        loadableId,
        mode,
        connectedRevisionId,
        connectedTestsetId,
        singleSelect,
        searchTerm,
    })
    const disabledChildIds = useMemo(
        () => (!isEdit && connectedRevisionId ? new Set([connectedRevisionId]) : undefined),
        [connectedRevisionId, isEdit],
    )

    const cancel = () => {
        selection.cancel()
        onCancel()
    }
    const showSets = wide || step === "sets"
    const showRows = wide || step === "rows"

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) cancel()
            }}
        >
            <DialogContent className="h-[min(720px,100%)] max-w-[1100px] gap-0 overflow-hidden p-0">
                <DialogHeader className="border-0 border-b border-solid border-border px-4 py-3">
                    <DialogTitle>
                        {isEdit ? "Edit test case selection" : "Load test set"}
                    </DialogTitle>
                </DialogHeader>
                <div className="flex min-h-0 flex-1">
                    {showSets ? (
                        <aside
                            className={
                                wide
                                    ? "w-1/3 shrink-0 overflow-y-auto border-0 border-r border-solid border-border p-3"
                                    : "min-w-0 flex-1 overflow-y-auto p-3"
                            }
                        >
                            {onCreate && !isEdit ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mb-3 w-full"
                                    onClick={onCreate}
                                >
                                    <Plus aria-hidden size={14} />
                                    Create a new test set
                                </Button>
                            ) : null}
                            <EntityPicker<TestsetSelectionResult>
                                variant="list-popover"
                                adapter={testsetAdapter}
                                onSelect={(picked) => {
                                    selection.setSelection(
                                        picked.metadata.revisionId,
                                        picked.metadata.testsetId,
                                    )
                                    setSearchTerm("")
                                    setStep("rows")
                                }}
                                selectedParentId={selection.selectedTestsetId}
                                selectedChildId={selection.selectedRevisionId}
                                showSearch
                                sectionLabel="Test sets"
                                emptyMessage="No test sets found"
                                popoverPlacement="rightTop"
                                // On a phone the first test set must not open its rows by itself.
                                autoSelectLatest={wide}
                                selectLatestOnParentClick
                                disabledChildIds={disabledChildIds}
                                disabledChildTooltip="Already connected"
                            />
                        </aside>
                    ) : null}
                    {showRows ? (
                        <section className="flex min-w-0 flex-1 flex-col gap-3 p-3">
                            {wide ? null : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="self-start"
                                    onClick={() => setStep("sets")}
                                >
                                    <CaretLeft aria-hidden size={14} />
                                    Test sets
                                </Button>
                            )}
                            {selection.selectedRevisionId ? (
                                <>
                                    <div className="relative shrink-0">
                                        <MagnifyingGlass
                                            aria-hidden
                                            size={14}
                                            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                                        />
                                        <Input
                                            type="search"
                                            aria-label="Search test cases"
                                            placeholder="Search test cases..."
                                            value={searchTerm}
                                            onChange={(event) => setSearchTerm(event.target.value)}
                                            className="pl-8"
                                        />
                                    </div>
                                    <div className="min-h-0 flex-1 overflow-auto">
                                        <TestcaseTable
                                            config={selection.tableConfig}
                                            selectable
                                            selectedIds={selection.selectedIds}
                                            onSelectionChange={selection.setSelectedIds}
                                            multiSelect={!singleSelect}
                                            selectionDisabled={selection.selectionDisabled}
                                            showSettings={false}
                                            canExportData={false}
                                        />
                                    </div>
                                </>
                            ) : (
                                <p className="m-auto text-sm text-muted-foreground">
                                    Select a test set to preview
                                </p>
                            )}
                        </section>
                    ) : null}
                </div>
                <DialogFooter className="m-0 flex-row items-center justify-between gap-3 px-4 py-3">
                    {selection.selectionDisabled ? (
                        <Alert
                            type="warning"
                            showIcon
                            className="text-xs"
                            message="Cannot select items from this test set"
                        />
                    ) : (
                        <p className="m-0 text-sm text-muted-foreground">
                            {selection.selectedRevisionId
                                ? `${selection.selectedIds.length} of ${selection.totalLabel} test cases selected`
                                : null}
                        </p>
                    )}
                    <div className="flex shrink-0 gap-2">
                        <Button variant="outline" onClick={cancel}>
                            Cancel
                        </Button>
                        {selection.selectionDisabled ? null : (
                            <Button
                                disabled={!selection.canConfirm}
                                onClick={() => onConfirm(selection.confirm())}
                            >
                                {selection.confirmLabel}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
