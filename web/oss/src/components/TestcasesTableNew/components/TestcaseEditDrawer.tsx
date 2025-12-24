import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {ArrowsOut, CaretDoubleRight, CaretDown, CaretUp, Copy} from "@phosphor-icons/react"
import {Button, Dropdown, Segmented, Space, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import {
    testcaseDraftAtomFamily,
    testcaseEntityAtomFamily,
    testcaseIsDirtyAtomFamily,
} from "@/oss/state/entities/testcase/testcaseEntity"

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
    // Read testcase from entity atom (server state + local draft)
    const testcaseAtom = useMemo(() => testcaseEntityAtomFamily(testcaseId || ""), [testcaseId])
    const testcase = useAtomValue(testcaseAtom)

    // Check if entity has actual data changes (compares draft vs server state)
    const isDirtyAtom = useMemo(() => testcaseIsDirtyAtomFamily(testcaseId || ""), [testcaseId])
    const isDirty = useAtomValue(isDirtyAtom)

    // Draft setter for restoring session state
    const setDraft = useSetAtom(testcaseDraftAtomFamily(testcaseId || ""))

    // Capture draft state when drawer opens (for session-based cancel)
    const [sessionStartDraft, setSessionStartDraft] = useState<FlattenedTestcase | null>(null)

    // Capture the current draft when drawer opens
    useEffect(() => {
        if (open && testcaseId) {
            // Capture the current entity state (server + draft merged) as the session start point
            setSessionStartDraft(testcase ? {...testcase} : null)
        }
    }, [open, testcaseId])

    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [isIdCopied, setIsIdCopied] = useState(false)
    const contentRef = useRef<TestcaseEditDrawerContentRef>(null)

    // Apply changes and close (draft is already in entity atom, just close)
    const handleApply = useCallback(() => {
        onClose()
    }, [onClose])

    // Apply changes and save entire testset (commit revision)
    const handleSaveTestset = useCallback(async () => {
        if (onSaveTestset) {
            await onSaveTestset()
        }
    }, [onSaveTestset])

    // Discard session changes and close (restore to state when drawer opened)
    const handleCancel = useCallback(() => {
        if (testcaseId) {
            // Restore to the state when drawer opened (not discard entirely)
            setDraft(sessionStartDraft)
        }
        onClose()
    }, [testcaseId, sessionStartDraft, setDraft, onClose])

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
                                    {
                                        key: "commit",
                                        label: "Apply and Commit Changes",
                                        onClick: handleSaveTestset,
                                        disabled: !isDirty,
                                    },
                                ],
                            }}
                        >
                            <Button
                                type="primary"
                                icon={<CaretUp size={14} />}
                                disabled={!isDirty}
                            />
                        </Dropdown>
                    </Space.Compact>
                </div>
            }
        >
            {open && testcaseId && testcase && (
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
