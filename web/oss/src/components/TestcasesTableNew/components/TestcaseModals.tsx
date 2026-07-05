import {useEffect, useState} from "react"

import {Input} from "@agenta/primitive-ui/components/input"
import {Textarea} from "@agenta/primitive-ui/components/textarea"
import {EnhancedModal} from "@agenta/ui/components/modal"

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

    // Sync initial values when modal opens (only on open, not on every render)
    useEffect(() => {
        if (isRenameModalOpen) {
            setEditModalName(initialTestsetName)
            setEditModalDescription(initialDescription)
        }
    }, [isRenameModalOpen, initialTestsetName, initialDescription])

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
            <EnhancedModal
                title="Edit Testset Details"
                open={isRenameModalOpen}
                onOk={handleRenameConfirm}
                onCancel={onRenameCancel}
                okText="Save"
                destroyOnHidden
            >
                <div className="flex flex-col gap-4">
                    <div>
                        <span className="block mb-1 font-semibold">Name</span>
                        <Input
                            value={editModalName}
                            onChange={(e) => setEditModalName(e.target.value)}
                            placeholder="Testset name"
                            autoFocus
                        />
                    </div>
                    <div>
                        <span className="block mb-1 font-semibold">Description</span>
                        <Textarea
                            value={editModalDescription}
                            onChange={(e) => setEditModalDescription(e.target.value)}
                            placeholder="Testset description (optional)"
                            rows={3}
                        />
                    </div>
                </div>
            </EnhancedModal>

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
            <EnhancedModal
                title="Add Column"
                open={isAddColumnModalOpen}
                onOk={handleAddColumn}
                onCancel={() => {
                    onAddColumnCancel()
                    setNewColumnName("")
                }}
                okText="Add"
                centered
                okButtonProps={{
                    disabled: !newColumnName.trim(),
                }}
                destroyOnHidden
            >
                <div className="py-2">
                    <span className="block mb-2">Column name:</span>
                    <Input
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        placeholder="Enter column name"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddColumn()
                        }}
                    />
                    <span className="text-xs mt-2 block text-muted-foreground">
                        Tip: Use dot notation to create nested columns. For example,{" "}
                        <code className="bg-gray-100 px-1 rounded">parent.child</code> creates a{" "}
                        <code className="bg-gray-100 px-1 rounded">child</code> column under the{" "}
                        <code className="bg-gray-100 px-1 rounded">parent</code> group.
                    </span>
                </div>
            </EnhancedModal>
        </>
    )
}
