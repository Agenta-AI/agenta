import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {ArrowsOut, CaretDoubleRight, CaretDown, CaretUp, Copy} from "@phosphor-icons/react"
import {Alert, Button, Dropdown, Segmented, Skeleton, Space, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import {testcase} from "@/oss/state/entities/testcase"

import TestcaseEditDrawerContent, {
    type TestcaseEditDrawerContentRef,
} from "./TestcaseEditDrawer/index"

type EditMode = "fields" | "json"

interface TestcaseEditDrawerProps {
    open: boolean
    onClose: () => void
    /** Testcase ID (reads from entity atom) */
    testcaseId: string | null
    columns: Column[]
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
    /** Callback to open the commit modal (for "Apply and Commit Changes") */
    onOpenCommitModal?: () => void
    /** Direct save callback (for contexts without commit modal, e.g., LoadTestsetModal) */
    onSaveTestset?: (params?: {testsetName?: string; commitMessage?: string}) => Promise<string | null>
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
    onOpenCommitModal,
    onSaveTestset,
    isSavingTestset = false,
}: TestcaseEditDrawerProps) => {
    // Use controller selectors for efficient subscriptions
    // data: entity with draft merged
    // query: loading/error states
    // isDirty: draft vs server comparison
    const testcaseData = useAtomValue(testcase.selectors.data(testcaseId || ""))
    const queryState = useAtomValue(testcase.selectors.query(testcaseId || ""))
    const isDirty = useAtomValue(testcase.selectors.isDirty(testcaseId || ""))

    // Get dispatch function without subscribing to controller state
    const dispatch = useSetAtom(testcase.controller(testcaseId || ""))

    // Capture draft state when drawer opens (for session-based cancel)
    const [sessionStartDraft, setSessionStartDraft] = useState<FlattenedTestcase | null>(null)
    const hasCapturedSessionDraft = useRef(false)

    // Capture the current draft when drawer opens (ONLY ONCE when opening)
    useEffect(() => {
        if (open && testcaseId && testcaseData && !hasCapturedSessionDraft.current) {
            // Capture the current entity state (server + draft merged) as the session start point
            // Only capture once when data is first available, not on subsequent edits
            setSessionStartDraft({...testcaseData})
            hasCapturedSessionDraft.current = true
        } else if (!open) {
            // Clear session draft when drawer closes and reset capture flag
            setSessionStartDraft(null)
            hasCapturedSessionDraft.current = false
        }
    }, [open, testcaseId, testcaseData])

    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [isIdCopied, setIsIdCopied] = useState(false)
    const contentRef = useRef<TestcaseEditDrawerContentRef>(null)

    // Apply changes and close (draft is already in entity atom, just close)
    const handleApply = useCallback(() => {
        onClose()
    }, [onClose])

    // Apply changes and open commit modal
    const handleOpenCommitModal = useCallback(() => {
        if (onOpenCommitModal) {
            onOpenCommitModal()
        }
    }, [onOpenCommitModal])

    // Apply changes and save directly (for contexts without commit modal)
    const handleSaveTestset = useCallback(async () => {
        if (onSaveTestset) {
            await onSaveTestset()
        }
    }, [onSaveTestset])

    // Discard session changes and close (restore to state when drawer opened)
    const handleCancel = useCallback(() => {
        if (testcaseId && sessionStartDraft) {
            // Restore to the state when drawer opened (not discard entirely)
            dispatch({type: "update", changes: sessionStartDraft})
        }
        onClose()
    }, [testcaseId, sessionStartDraft, dispatch, onClose])

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
                    {/* Expand to full screen */}
                    <Tooltip title="Open in full screen">
                        <Button type="text" size="small" icon={<ArrowsOut size={14} />} disabled />
                    </Tooltip>

                    {/* Close drawer */}
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretDoubleRight size={14} />}
                        onClick={handleCancel}
                    />

                    {/* Navigation */}
                    {(onPrevious || onNext) && (
                        <div className="flex items-center">
                            <Button
                                type="text"
                                size="small"
                                icon={<CaretUp size={14} />}
                                disabled={!hasPrevious}
                                onClick={onPrevious}
                            />
                            <Button
                                type="text"
                                size="small"
                                icon={<CaretDown size={14} />}
                                disabled={!hasNext}
                                onClick={onNext}
                            />
                        </div>
                    )}

                    {/* Title */}
                    <span className="font-medium text-sm">
                        {isNewRow ? "New Testcase" : `Testcase ${testcaseNumber ?? ""}`}
                    </span>

                    {/* Copy ID */}
                    {testcaseId && !isNewRow && (
                        <Tooltip title={isIdCopied ? "Copied!" : "Copy ID"}>
                            <Button
                                type="text"
                                size="small"
                                icon={<Copy size={14} />}
                                onClick={handleCopyId}
                            />
                        </Tooltip>
                    )}
                </div>

                {/* Edit mode toggle */}
                <div className="flex items-center gap-2">
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
        handleCancel,
        isNewRow,
    ])

    return (
        <EnhancedDrawer
            title={title}
            open={open}
            onClose={handleCancel}
            size="large"
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
                    <Space.Compact>
                        <Button
                            type="primary"
                            onClick={handleApply}
                            disabled={!isDirty}
                            loading={isSavingTestset}
                        >
                            Apply and Continue Editing
                        </Button>
                        <Dropdown
                            placement="topRight"
                            menu={{
                                items: [
                                    // Show "Apply and Commit Changes" when commit modal is available
                                    ...(onOpenCommitModal
                                        ? [
                                              {
                                                  key: "commit",
                                                  label: "Apply and Commit Changes",
                                                  onClick: handleOpenCommitModal,
                                                  disabled: !isDirty,
                                              },
                                          ]
                                        : []),
                                    // Show "Save Testset" when direct save is available
                                    ...(onSaveTestset
                                        ? [
                                              {
                                                  key: "save",
                                                  label: "Apply and Save Testset",
                                                  onClick: handleSaveTestset,
                                                  disabled: !isDirty,
                                              },
                                          ]
                                        : []),
                                ],
                            }}
                        >
                            <Button
                                type="primary"
                                icon={<CaretUp size={14} />}
                                disabled={!isDirty || (!onOpenCommitModal && !onSaveTestset)}
                            />
                        </Dropdown>
                    </Space.Compact>
                </div>
            }
        >
            {open && testcaseId && (
                <>
                    {/* Loading state */}
                    {queryState.isPending && (
                        <div className="p-6 space-y-4">
                            <Skeleton active paragraph={{rows: 8}} />
                        </div>
                    )}

                    {/* Error state */}
                    {queryState.isError && (
                        <div className="p-6">
                            <Alert
                                type="error"
                                message="Failed to load testcase"
                                description={queryState.error?.message || "Unknown error"}
                                showIcon
                            />
                        </div>
                    )}

                    {/* Loaded state */}
                    {testcaseData && (
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
                </>
            )}
        </EnhancedDrawer>
    )
}

export default TestcaseEditDrawer
