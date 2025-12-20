import {PlusOutlined} from "@ant-design/icons"
import {Button, Space} from "antd"

/**
 * Props for TestcaseActions component
 */
export interface TestcaseActionsProps {
    mode: "edit" | "view"
    hasUnsavedChanges: boolean
    isSaving: boolean
    onAddTestcase: () => void
    onAddColumn: () => void
    onDiscard: () => void
    onCommit: () => void
}

/**
 * TestcaseActions - Primary action buttons bar
 *
 * Displays:
 * - Discard button (when there are unsaved changes)
 * - Add Row button
 * - Add Column button
 * - Commit button (primary, enabled when there are changes)
 *
 * @component
 */
export function TestcaseActions(props: TestcaseActionsProps) {
    const {mode, hasUnsavedChanges, isSaving, onAddTestcase, onAddColumn, onDiscard, onCommit} =
        props

    return (
        <Space>
            {hasUnsavedChanges && (
                <Button onClick={onDiscard} disabled={mode === "view"}>
                    Discard
                </Button>
            )}
            <Button onClick={onAddTestcase} icon={<PlusOutlined />} disabled={mode === "view"}>
                Row
            </Button>
            <Button onClick={onAddColumn} icon={<PlusOutlined />} disabled={mode === "view"}>
                Column
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
