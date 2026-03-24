import {PlusOutlined, UploadOutlined} from "@ant-design/icons"
import {ListChecks} from "@phosphor-icons/react"
import {Button, Space, Tooltip} from "antd"
import dynamic from "next/dynamic"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

/**
 * Props for TestcaseActions component
 */
export interface TestcaseActionsProps {
    mode: "edit" | "view"
    hasUnsavedChanges: boolean
    isSaving: boolean
    onAddTestcase: () => void
    onDiscard: () => void
    onCommit: () => void
    onImportCSV: () => void
    /** Whether this is a new testset (disables discard since there's no server state) */
    isNewTestset?: boolean
    /** Selected row keys (testcase IDs) for bulk actions */
    selectedRowKeys?: React.Key[]
    /** All persisted testcase IDs in the current revision (excludes unsaved new rows) */
    allTestcaseIds?: string[]
}

/**
 * TestcaseActions - Primary action buttons bar
 *
 * Displays:
 * - Discard button (when there are unsaved changes and not a new testset)
 * - Import CSV button
 * - Add Row button
 * - Commit button (primary, enabled when there are changes)
 *
 * Note: Add Column button is now in the table header next to the settings cog
 *
 * @component
 */
export function TestcaseActions(props: TestcaseActionsProps) {
    const {
        mode,
        hasUnsavedChanges,
        isSaving,
        onAddTestcase,
        onDiscard,
        onCommit,
        onImportCSV,
        isNewTestset = false,
        selectedRowKeys = [],
        allTestcaseIds = [],
    } = props

    const selectedIds = selectedRowKeys.map(String).filter((id) => !id.startsWith("new-"))
    const effectiveQueueIds = selectedIds.length > 0 ? selectedIds : allTestcaseIds
    const isQueueActionDisabled = effectiveQueueIds.length === 0 || mode === "view"

    return (
        <Space>
            {hasUnsavedChanges && (
                <Button onClick={onDiscard} disabled={mode === "view" || isNewTestset}>
                    Discard
                </Button>
            )}
            <Tooltip title="Import CSV/JSON file as new revision">
                <Button
                    onClick={onImportCSV}
                    icon={<UploadOutlined />}
                    disabled={mode === "view" || isNewTestset}
                >
                    Import
                </Button>
            </Tooltip>
            <Button onClick={onAddTestcase} icon={<PlusOutlined />} disabled={mode === "view"}>
                Add row
            </Button>
            <AddToQueuePopover
                itemType="testcases"
                itemIds={effectiveQueueIds}
                disabled={isQueueActionDisabled}
            >
                <Button icon={<ListChecks size={14} />} disabled={isQueueActionDisabled}>
                    Add annotation queue
                </Button>
            </AddToQueuePopover>
            <Button
                type="primary"
                onClick={onCommit}
                loading={isSaving}
                disabled={!hasUnsavedChanges || mode === "view"}
            >
                Commit
            </Button>
        </Space>
    )
}
