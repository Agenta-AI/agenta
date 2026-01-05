import {PlusOutlined, UploadOutlined} from "@ant-design/icons"
import {Button, Space, Tooltip} from "antd"

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
    } = props

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
                Row
            </Button>
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
