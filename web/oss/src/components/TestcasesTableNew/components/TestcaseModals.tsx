import {useState} from "react"

import {Input, Modal, Typography} from "antd"

import type {ChangesSummary} from "../hooks/types"

import CommitTestsetModal from "./CommitTestsetModal"

/**
 * Props for TestcaseModals component
 */
export interface TestcaseModalsProps {
    // Rename Modal
    isRenameModalOpen: boolean
    onRenameCancel: () => void
    onRenameConfirm: (name: string, description: string) => void
    initialTestsetName: string
    initialDescription: string

    // Commit Modal
    isCommitModalOpen: boolean
    onCommitCancel: () => void
    onCommit: (message: string) => Promise<void>
    changesSummary?: ChangesSummary
    isSaving: boolean
    currentVersion?: number
    latestVersion?: number

    // Add Column Modal
    isAddColumnModalOpen: boolean
    onAddColumnCancel: () => void
    onAddColumn: (columnName: string) => void
}

/**
 * TestcaseModals - Groups all modal dialogs for the testcases table
 *
 * Includes:
 * - Rename modal (testset name & description)
 * - Commit modal (save changes with message)
 * - Add column modal (add new column)
 *
 * @component
 */
export function TestcaseModals(props: TestcaseModalsProps) {
    const {
        isRenameModalOpen,
        onRenameCancel,
        onRenameConfirm,
        initialTestsetName,
        initialDescription,
        isCommitModalOpen,
        onCommitCancel,
        onCommit,
        changesSummary,
        isSaving,
        currentVersion,
        latestVersion,
        isAddColumnModalOpen,
        onAddColumnCancel,
        onAddColumn,
    } = props

    // Local state for edit modal (to allow cancel without saving)
    const [editModalName, setEditModalName] = useState(initialTestsetName)
    const [editModalDescription, setEditModalDescription] = useState(initialDescription)

    // Local state for add column modal
    const [newColumnName, setNewColumnName] = useState("")

    // Sync initial values when modal opens
    if (isRenameModalOpen && editModalName !== initialTestsetName) {
        setEditModalName(initialTestsetName)
        setEditModalDescription(initialDescription)
    }

    const handleRenameConfirm = () => {
        onRenameConfirm(editModalName, editModalDescription)
    }

    const handleAddColumn = () => {
        onAddColumn(newColumnName)
        setNewColumnName("")
    }

    return (
        <>
            {/* Rename Modal */}
            <Modal
                title="Edit Testset Details"
                open={isRenameModalOpen}
                onOk={handleRenameConfirm}
                onCancel={onRenameCancel}
                okText="Save"
                destroyOnHidden
            >
                <div className="flex flex-col gap-4">
                    <div>
                        <Typography.Text strong className="block mb-1">
                            Name
                        </Typography.Text>
                        <Input
                            value={editModalName}
                            onChange={(e) => setEditModalName(e.target.value)}
                            placeholder="Testset name"
                            autoFocus
                        />
                    </div>
                    <div>
                        <Typography.Text strong className="block mb-1">
                            Description
                        </Typography.Text>
                        <Input.TextArea
                            value={editModalDescription}
                            onChange={(e) => setEditModalDescription(e.target.value)}
                            placeholder="Testset description (optional)"
                            rows={3}
                        />
                    </div>
                </div>
            </Modal>

            {/* Commit Modal */}
            <CommitTestsetModal
                open={isCommitModalOpen}
                onCancel={onCommitCancel}
                onCommit={onCommit}
                isCommitting={isSaving}
                changesSummary={changesSummary}
                currentVersion={currentVersion}
                latestVersion={latestVersion}
            />

            {/* Add Column Modal */}
            <Modal
                title="Add Column"
                open={isAddColumnModalOpen}
                onOk={handleAddColumn}
                onCancel={() => {
                    onAddColumnCancel()
                    setNewColumnName("")
                }}
                okText="Add"
                okButtonProps={{
                    disabled: !newColumnName.trim(),
                }}
                destroyOnHidden
            >
                <div className="py-2">
                    <Typography.Text className="block mb-2">Column name:</Typography.Text>
                    <Input
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        placeholder="Enter column name"
                        onPressEnter={handleAddColumn}
                        autoFocus
                    />
                    <Typography.Text type="secondary" className="text-xs mt-2 block">
                        Tip: Use dot notation to create nested columns. For example,{" "}
                        <code className="bg-gray-100 px-1 rounded">parent.child</code> creates a{" "}
                        <code className="bg-gray-100 px-1 rounded">child</code> column under the{" "}
                        <code className="bg-gray-100 px-1 rounded">parent</code> group.
                    </Typography.Text>
                </div>
            </Modal>
        </>
    )
}
