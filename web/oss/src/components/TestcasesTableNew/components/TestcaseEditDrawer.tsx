import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {ArrowsOut, CaretDoubleRight, CaretDown, CaretUp, Copy} from "@phosphor-icons/react"
import {Button, Dropdown, Segmented, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import type {EditableTableColumn} from "@/oss/components/InfiniteVirtualTable/hooks/useEditableTable"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {useEntityCached, useEntityMutation} from "@/oss/state/entities"
import {testcaseDraftStore} from "@/oss/state/entities/testcase/draftStore"
import {testcaseStore} from "@/oss/state/entities/testcase/store"

import TestcaseEditDrawerContent, {
    type TestcaseEditDrawerContentRef,
} from "./TestcaseEditDrawerContent"

type EditMode = "fields" | "json"

interface TestcaseEditDrawerProps {
    open: boolean
    onClose: () => void
    /** Testcase ID (reads from entity atom) */
    testcaseId: string | null
    columns: EditableTableColumn[]
    isNewRow: boolean
    afterOpenChange?: (open: boolean) => void
    /** Navigate to previous testcase */
    onPrevious?: () => void
    /** Navigate to next testcase */
    onNext?: () => void
    /** Whether there's a previous testcase */
    hasPrevious?: boolean
    /** Whether there's a next testcase */
    hasNext?: boolean
    /** 1-based index of the testcase for display */
    testcaseNumber?: number
    /** Callback to save the entire testset (commit revision). Returns new revision ID on success. */
    onSaveTestset?: () => Promise<string | null>
    /** Whether testset save is in progress */
    isSavingTestset?: boolean
}

const TestcaseEditDrawer = ({
    open,
    onClose,
    testcaseId,
    columns,
    isNewRow,
    afterOpenChange,
    onPrevious,
    onNext,
    hasPrevious = false,
    hasNext = false,
    testcaseNumber,
    onSaveTestset,
    isSavingTestset = false,
}: TestcaseEditDrawerProps) => {
    // Read testcase from entity atom (server state)
    const testcase = useEntityCached(testcaseStore, testcaseId || "")

    // Draft store atoms
    const initDraft = useSetAtom(testcaseDraftStore.initDraft)
    const discardDraft = useSetAtom(testcaseDraftStore.discardDraft)
    const commitDraft = useSetAtom(testcaseDraftStore.commitDraft)

    // Draft state for current testcase
    const draft = useAtomValue(testcaseDraftStore.draft(testcaseId || ""))
    const original = useAtomValue(testcaseDraftStore.original(testcaseId || ""))
    const isDirty = useAtomValue(testcaseDraftStore.isDirty(testcaseId || ""))

    // Entity mutation for restoring on discard
    const {update: entityUpdate} = useEntityMutation(testcaseStore)

    // Track if we've initialized the draft for this drawer session
    const hasInitializedRef = useRef(false)

    // Initialize draft only when drawer first opens (not on every testcase data change)
    useEffect(() => {
        if (open && testcaseId && testcase && !hasInitializedRef.current) {
            initDraft({id: testcaseId, entity: testcase})
            hasInitializedRef.current = true
        }
        // Reset when drawer closes or testcaseId changes
        if (!open || !testcaseId) {
            hasInitializedRef.current = false
        }
    }, [open, testcaseId, testcase, initDraft])

    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [isIdCopied, setIsIdCopied] = useState(false)
    const contentRef = useRef<TestcaseEditDrawerContentRef>(null)

    // Apply changes: commit draft and sync to entity store, then close
    const handleApply = useCallback(() => {
        if (testcaseId && draft) {
            // Sync draft to entity store
            contentRef.current?.handleSave()
            // Commit draft (make current the new original, clear history)
            commitDraft(testcaseId)
        }
        onClose()
    }, [testcaseId, draft, commitDraft, onClose])

    // Apply changes and save entire testset (commit revision)
    const handleSaveTestset = useCallback(async () => {
        if (testcaseId && draft) {
            contentRef.current?.handleSave()
            commitDraft(testcaseId)
        }
        if (onSaveTestset) {
            await onSaveTestset()
        }
    }, [testcaseId, draft, commitDraft, onSaveTestset])

    // Clear entity dirty flag
    const clearDirty = useSetAtom(testcaseStore.clearDirtyAtom)

    // Discard changes made in THIS drawer session only
    // If no changes were made in this session (isDirty is false), just close without reverting
    const handleCancel = useCallback(() => {
        if (testcaseId && isDirty) {
            // Only revert if changes were made in this session
            if (original) {
                // Restore entity store to the state when drawer opened
                entityUpdate({id: testcaseId, updates: original})
            }
            // Clear the entity store's dirty flag only if we reverted
            clearDirty(testcaseId)
        }
        if (testcaseId) {
            // Always discard the draft (clears undo/redo history for this session)
            discardDraft(testcaseId)
        }
        onClose()
    }, [testcaseId, original, isDirty, entityUpdate, discardDraft, clearDirty, onClose])

    const handleCopyId = useCallback(async () => {
        if (!testcaseId) return
        await copyToClipboard(testcaseId, false)
        setIsIdCopied(true)
        setTimeout(() => setIsIdCopied(false), 2000)
    }, [testcaseId])

    const title = useMemo(() => {
        return (
            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1">
                    {/* Close drawer */}
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretDoubleRight size={16} />}
                        onClick={onClose}
                    />
                    {/* Expand control */}
                    <Button type="text" size="small" icon={<ArrowsOut size={16} />} />
                    {/* Navigation arrows */}
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretUp size={16} />}
                        onClick={onPrevious}
                        disabled={!hasPrevious}
                    />
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretDown size={16} />}
                        onClick={onNext}
                        disabled={!hasNext}
                    />
                    {/* Testcase number with copy ID */}
                    {testcaseId && (
                        <Tooltip title={isIdCopied ? "Copied!" : "Click to copy ID"}>
                            <Button
                                type="text"
                                size="small"
                                onClick={handleCopyId}
                                className="flex items-center gap-1"
                            >
                                Testcase #{testcaseNumber ?? "?"}
                                <Copy size={14} />
                            </Button>
                        </Tooltip>
                    )}
                </div>
                <Segmented
                    size="small"
                    value={editMode}
                    onChange={(value) => setEditMode(value as EditMode)}
                    options={[
                        {label: "Fields", value: "fields"},
                        {label: "JSON", value: "json"},
                    ]}
                />
            </div>
        )
    }, [
        testcaseId,
        editMode,
        onPrevious,
        onNext,
        hasPrevious,
        hasNext,
        handleCopyId,
        isIdCopied,
        testcaseNumber,
        onClose,
    ])

    return (
        <EnhancedDrawer
            title={title}
            open={open}
            onClose={handleCancel}
            width={600}
            closeIcon={null}
            closeOnLayoutClick={false}
            afterOpenChange={afterOpenChange}
            destroyOnHidden
            styles={{
                body: {padding: "0px"},
                footer: {padding: "12px 24px", display: "flex", justifyContent: "flex-end"},
            }}
            footer={
                <div className="w-full flex items-center justify-end gap-3">
                    <Button onClick={handleCancel}>Cancel</Button>
                    <div>
                        <Dropdown.Button
                            type="primary"
                            onClick={handleApply}
                            disabled={!isDirty}
                            loading={isSavingTestset}
                            icon={<CaretUp size={14} />}
                            placement="topRight"
                            menu={{
                                items: [
                                    {
                                        key: "commit",
                                        label: "Apply and Commit Changes",
                                        onClick: handleSaveTestset,
                                    },
                                ],
                            }}
                        >
                            Apply and Continue Editing
                        </Dropdown.Button>
                    </div>
                </div>
            }
        >
            {open && testcaseId && draft && (
                <TestcaseEditDrawerContent
                    ref={contentRef}
                    testcaseId={testcaseId}
                    columns={columns}
                    isNewRow={isNewRow}
                    onClose={onClose}
                    editMode={editMode}
                    onEditModeChange={setEditMode}
                />
            )}
        </EnhancedDrawer>
    )
}

export default TestcaseEditDrawer
