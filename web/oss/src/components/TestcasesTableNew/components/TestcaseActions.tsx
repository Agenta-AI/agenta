import {PlusOutlined, UploadOutlined} from "@ant-design/icons"
import {Button, Space, Tooltip} from "antd"

import AddActionsDropdown from "@/oss/components/SharedActions/AddActionsDropdown"

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
    } = props

    const selectedIds = selectedRowKeys.map(String).filter((id) => !id.startsWith("new-"))

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
            <AddActionsDropdown
                size="middle"
                disabled={mode === "view"}
                additionalActions={[
                    {
                        key: "row",
                        label: "Add row",
                        icon: <PlusOutlined />,
                        disabled: mode === "view",
                        onSelect: onAddTestcase,
                    },
                ]}
                queueAction={{
                    itemType: "testcases",
                    itemIds: selectedIds,
                    disabled: selectedIds.length === 0 || mode === "view",
                }}
            />
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
