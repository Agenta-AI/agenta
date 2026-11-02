import {useMemo, useState} from "react"

import {annotationSessionController, type SessionView} from "@agenta/annotation"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {
    LoadingButton,
    SearchInput,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {AnnotateScenarioSheet} from "./AnnotateScenarioSheet"
import {toEvaluatorColumns} from "./scenarioListColumns"
import {ScenarioListRow} from "./ScenarioListRow"
import {useScenarioRows, type ScenarioRow} from "./useScenarioRows"

const ALL_STATUSES = "all"
const STATUS_OPTIONS = [
    {value: ALL_STATUSES, label: "All status"},
    {value: "pending", label: "Pending"},
    {value: "queued", label: "Queued"},
    {value: "running", label: "Running"},
    {value: "success", label: "Success"},
    {value: "failure", label: "Failure"},
    {value: "errors", label: "Errors"},
    {value: "cancelled", label: "Cancelled"},
]

const LEADING_COLUMNS: ListTableColumn[] = [
    {key: "select", label: "Select", srOnly: true, width: "28px"},
    {key: "index", label: "#", width: "56px"},
    {key: "item", label: "Item", width: "minmax(160px,2fr)"},
]
const TRAILING_COLUMNS: ListTableColumn[] = [
    {key: "status", label: "Status", width: "96px"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

/**
 * Every item of the queue in one list: search, a status filter, a selection for Add to Testset, a
 * sheet to annotate one item, and a jump to the focus view.
 */
export const ScenarioListTab = ({
    queueId,
    onViewChange,
}: {
    queueId: string
    onViewChange: (view: SessionView) => void
}) => {
    const [search, setSearch] = useState("")
    const [status, setStatus] = useState<string | null>(null)
    const [sheetScenarioId, setSheetScenarioId] = useState<string | null>(null)
    const columnDefs = useAtomValue(annotationSessionController.selectors.listColumnDefs())
    const selectedIds = useAtomValue(annotationSessionController.selectors.selectedScenarioIds())
    const canAddToTestset = useAtomValue(annotationSessionController.selectors.canAddToTestset())
    const isExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    const setSelectedIds = useSetAtom(annotationSessionController.actions.setSelectedScenarioIds)
    const openAddToTestset = useSetAtom(annotationSessionController.actions.openAddToTestsetModal)
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)

    const evaluatorColumns = useMemo(() => toEvaluatorColumns(columnDefs), [columnDefs])
    const rows = useScenarioRows({search, status, columns: evaluatorColumns})
    const columns = useMemo<ListTableColumn[]>(
        () => [
            ...LEADING_COLUMNS,
            ...evaluatorColumns.map((column) => ({
                key: column.key,
                label: column.title,
                width: "minmax(140px,1fr)",
            })),
            ...TRAILING_COLUMNS,
        ],
        [evaluatorColumns],
    )
    const selected = useMemo(() => new Set(selectedIds), [selectedIds])

    const toggleSelected = (row: ScenarioRow, isSelected: boolean) =>
        setSelectedIds(
            isSelected
                ? [...selectedIds, row.scenarioId]
                : selectedIds.filter((id) => id !== row.scenarioId),
        )
    const addToTestset = () =>
        selectedIds.length > 0
            ? openAddToTestset({scope: "selected", scenarioIds: selectedIds})
            : openAddToTestset({scope: "all"})
    const openInFocus = (row: ScenarioRow) => {
        navigateToIndex(row.index)
        onViewChange("annotate")
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-6 pt-3">
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                    aria-label="Search"
                    placeholder="Search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full sm:w-60"
                />
                <Select
                    value={status ?? ALL_STATUSES}
                    onValueChange={(next) => setStatus(next === ALL_STATUSES ? null : next)}
                >
                    <SelectTrigger aria-label="Status" className="w-[140px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <LoadingButton
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    loading={isExporting}
                    disabled={!canAddToTestset}
                    onClick={addToTestset}
                >
                    <Plus aria-hidden size={14} />
                    Add to Testset
                </LoadingButton>
            </div>
            <ListTable
                columns={columns}
                minWidth={columns.length > 6 ? 900 : 640}
                density="compact"
                groups={[{key: "all", label: null, rows}]}
                rowKey={(row) => row.scenarioId}
                onOpenRow={(row) => setSheetScenarioId(row.scenarioId)}
                empty={
                    <p className="m-0 py-10 text-center text-sm text-muted-foreground">
                        No items match your filters
                    </p>
                }
                renderRow={(row) => (
                    <ScenarioListRow
                        row={row}
                        columns={evaluatorColumns}
                        selected={selected.has(row.scenarioId)}
                        onSelectedChange={(isSelected) => toggleSelected(row, isSelected)}
                        onAnnotate={() => setSheetScenarioId(row.scenarioId)}
                        onOpenInFocus={() => openInFocus(row)}
                    />
                )}
            />
            <AnnotateScenarioSheet
                scenarioId={sheetScenarioId}
                queueId={queueId}
                onClose={() => setSheetScenarioId(null)}
            />
        </div>
    )
}
