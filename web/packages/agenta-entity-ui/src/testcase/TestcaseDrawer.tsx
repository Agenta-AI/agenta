import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {copyToClipboard} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ViewModeDropdown} from "@agenta/ui/drill-in"
import {
    ArrowsInLineVertical,
    CaretDoubleRight,
    CaretDown,
    CaretUp,
    Check,
    Copy,
    CornersIn,
    CornersOut,
} from "@phosphor-icons/react"
import {Alert, Button, Dropdown, Skeleton, Space, Tooltip} from "antd"

import type {RootDrawerViewMode} from "./codeFormat"

const EXPANDED_DRAWER_WIDTH = 1920

const ROOT_VIEW_OPTIONS: {value: RootDrawerViewMode; label: string}[] = [
    {value: "form", label: "Form"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

export interface TestcaseDrawerContentRenderProps {
    initialPath: string[]
    onPathChange: (path: string[]) => void
    rootViewMode: RootDrawerViewMode
    collapseSignal: number
}

export interface TestcaseDrawerProps<TData = unknown> {
    open: boolean
    onClose: () => void
    testcaseId: string | null
    isNewRow: boolean
    afterOpenChange?: (open: boolean) => void
    onPrevious?: () => void
    onNext?: () => void
    hasPrevious?: boolean
    hasNext?: boolean
    testcaseNumber?: number
    onOpenCommitModal?: () => void
    onSaveTestset?: (params?: {
        testsetName?: string
        commitMessage?: string
    }) => Promise<string | null>
    isSavingTestset?: boolean
    testcaseData: TData | null
    isLoading: boolean
    isError: boolean
    errorMessage?: string
    isDirty: boolean
    onRestoreSessionStart?: (data: TData) => void
    renderContent: (props: TestcaseDrawerContentRenderProps) => ReactNode
    renderAddToQueue?: (itemIds: string[]) => ReactNode
    renderOutputs?: (testcaseId: string) => ReactNode
    viewOnly?: boolean
    displayId?: string
    copyId?: string
    /** Whether to show the drawer-width expand action in the header. Defaults to true. */
    showExpandButton?: boolean
    /**
     * Edit semantics.
     * - "deferred" (default): drafts buffered, footer with Apply/Commit/Save shown.
     * - "autoApply": edits applied live by the consumer's onChange; no footer, no
     *   "edited" badge, no session-restore on close. Used by the playground.
     */
    editMode?: "deferred" | "autoApply"
    /** Close drawer when clicking on .ant-layout outside. Defaults to false. */
    closeOnLayoutClick?: boolean
    /** Optional initial drawer width. When unset, falls back to size="large". */
    initialWidth?: number
    /**
     * Optional slot for evaluator-metric chips/rows.
     * Renders above the data editor when provided. The wrapper resolves
     * metrics from trace/annotation data — the shell stays platform-neutral.
     */
    renderEvaluatorMetrics?: (testcaseId: string) => ReactNode
    /**
     * When true, the drawer header renders the Form/JSON/YAML view-mode
     * dropdown plus Collapse-all and Copy-payload buttons, and pipes the
     * selected `rootViewMode` + `collapseSignal` through `renderContent`.
     * Defaults to false so existing consumers (eval/playground adapters)
     * keep their current header chrome.
     */
    enableRootViewMode?: boolean
}

function TestcaseDrawer<TData = unknown>({
    open,
    onClose,
    testcaseId,
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
    testcaseData,
    isLoading,
    isError,
    errorMessage,
    isDirty,
    onRestoreSessionStart,
    renderContent,
    renderAddToQueue,
    renderOutputs,
    viewOnly = false,
    displayId,
    copyId,
    showExpandButton = true,
    editMode = "deferred",
    closeOnLayoutClick = false,
    initialWidth,
    renderEvaluatorMetrics,
    enableRootViewMode = false,
}: TestcaseDrawerProps<TData>) {
    const skipDeferredFlow = viewOnly || editMode === "autoApply"
    const sessionStartDraftsRef = useRef<Map<string, TData>>(new Map())
    const sessionStartDraft = testcaseId
        ? (sessionStartDraftsRef.current.get(testcaseId) ?? null)
        : null

    const [isIdCopied, setIsIdCopied] = useState(false)
    const [isPayloadCopied, setIsPayloadCopied] = useState(false)
    const [isDrawerExpanded, setIsDrawerExpanded] = useState(false)
    const [drillInPath, setDrillInPath] = useState<string[]>([])
    const [everDirtyIds, setEverDirtyIds] = useState<Set<string>>(new Set())
    const [rootViewMode, setRootViewMode] = useState<RootDrawerViewMode>("form")
    const [collapseSignal, setCollapseSignal] = useState(0)

    useEffect(() => {
        if (skipDeferredFlow) return
        if (open && testcaseId && isDirty) {
            setEverDirtyIds((prev) => {
                if (prev.has(testcaseId)) return prev
                const next = new Set(prev)
                next.add(testcaseId)
                return next
            })
        }
    }, [open, testcaseId, isDirty, skipDeferredFlow])

    useEffect(() => {
        if (!open) {
            setEverDirtyIds((prev) => (prev.size === 0 ? prev : new Set()))
        }
    }, [open])

    const hasSessionDirty = everDirtyIds.size > 0

    useEffect(() => {
        if (open && testcaseId && testcaseData) {
            if (!sessionStartDraftsRef.current.has(testcaseId)) {
                sessionStartDraftsRef.current.set(
                    testcaseId,
                    JSON.parse(JSON.stringify(testcaseData)),
                )
            }
        } else if (!open) {
            sessionStartDraftsRef.current.clear()
            setDrillInPath([])
            setRootViewMode("form")
            setCollapseSignal(0)
        }
    }, [open, testcaseId, testcaseData])

    useEffect(() => {
        if (open) setDrillInPath([])
    }, [testcaseId, open])

    // "Apply" closes the drawer while keeping the draft.
    // Unlike `handleCancel`, it does NOT call `onRestoreSessionStart` —
    // the draft survives so the user can commit it later via testset save.
    const handleApply = useCallback(() => {
        onClose()
    }, [onClose])

    const handleOpenCommitModal = useCallback(() => {
        onOpenCommitModal?.()
    }, [onOpenCommitModal])

    const handleSaveTestset = useCallback(async () => {
        await onSaveTestset?.()
    }, [onSaveTestset])

    const handleCancel = useCallback(() => {
        if (!skipDeferredFlow && testcaseId && sessionStartDraft) {
            onRestoreSessionStart?.(sessionStartDraft)
        }
        onClose()
    }, [testcaseId, sessionStartDraft, onRestoreSessionStart, onClose, skipDeferredFlow])

    const handleCopyId = useCallback(async () => {
        const idToCopy = copyId ?? displayId ?? testcaseId
        if (!idToCopy) return
        await copyToClipboard(idToCopy)
        setIsIdCopied(true)
        setTimeout(() => setIsIdCopied(false), 2000)
    }, [copyId, displayId, testcaseId])

    const handleCopyPayload = useCallback(async () => {
        if (testcaseData == null) return
        await copyToClipboard(JSON.stringify(testcaseData, null, 2))
        setIsPayloadCopied(true)
        setTimeout(() => setIsPayloadCopied(false), 2000)
    }, [testcaseData])

    const handleCollapseAll = useCallback(() => {
        setCollapseSignal((signal) => signal + 1)
    }, [])

    const queueItemIds = useMemo(
        () => (testcaseId && !isNewRow && !testcaseId.startsWith("new-") ? [testcaseId] : []),
        [testcaseId, isNewRow],
    )

    const title = useMemo(
        () => (
            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1">
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretDoubleRight size={14} />}
                        onClick={handleCancel}
                    />
                    {showExpandButton && (
                        <Tooltip
                            title={isDrawerExpanded ? "Restore drawer width" : "Expand drawer"}
                        >
                            <Button
                                type="text"
                                size="small"
                                icon={
                                    isDrawerExpanded ? (
                                        <CornersIn size={14} />
                                    ) : (
                                        <CornersOut size={14} />
                                    )
                                }
                                onClick={() => setIsDrawerExpanded((value) => !value)}
                            />
                        </Tooltip>
                    )}
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
                    <span className="font-medium text-sm">
                        {isNewRow ? "New Testcase" : `Testcase ${testcaseNumber ?? ""}`}
                    </span>
                    {!skipDeferredFlow && isDirty && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            edited
                        </span>
                    )}
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
                <div className="flex items-center gap-2">
                    {enableRootViewMode && (
                        <>
                            {rootViewMode === "form" && (
                                <Tooltip title="Collapse all">
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<ArrowsInLineVertical size={14} />}
                                        onClick={handleCollapseAll}
                                        aria-label="Collapse all fields"
                                    />
                                </Tooltip>
                            )}
                            <Tooltip title={isPayloadCopied ? "Copied" : "Copy testcase"}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={
                                        isPayloadCopied ? <Check size={14} /> : <Copy size={14} />
                                    }
                                    onClick={handleCopyPayload}
                                    aria-label="Copy testcase payload"
                                />
                            </Tooltip>
                            <ViewModeDropdown<RootDrawerViewMode>
                                value={rootViewMode}
                                options={ROOT_VIEW_OPTIONS}
                                onChange={setRootViewMode}
                            />
                        </>
                    )}
                    {renderAddToQueue ? renderAddToQueue(queueItemIds) : null}
                </div>
            </div>
        ),
        [
            testcaseId,
            isNewRow,
            onPrevious,
            onNext,
            hasPrevious,
            hasNext,
            handleCopyId,
            isIdCopied,
            isDrawerExpanded,
            testcaseNumber,
            handleCancel,
            isDirty,
            skipDeferredFlow,
            showExpandButton,
            queueItemIds,
            renderAddToQueue,
            enableRootViewMode,
            rootViewMode,
            handleCollapseAll,
            handleCopyPayload,
            isPayloadCopied,
        ],
    )

    return (
        <EnhancedDrawer
            title={title}
            open={open}
            onClose={handleCancel}
            size="large"
            width={isDrawerExpanded ? EXPANDED_DRAWER_WIDTH : (initialWidth ?? undefined)}
            closeIcon={null}
            closeOnLayoutClick={closeOnLayoutClick}
            afterOpenChange={afterOpenChange}
            destroyOnHidden
            styles={{
                body: {padding: "0px"},
                footer: {padding: "12px 24px", display: "flex", justifyContent: "flex-end"},
            }}
            footer={
                skipDeferredFlow ? null : (
                    <div className="w-full flex items-center justify-end gap-3">
                        <Button onClick={handleCancel}>Cancel</Button>
                        <Space.Compact>
                            <Button
                                type="primary"
                                onClick={handleApply}
                                disabled={!hasSessionDirty}
                                loading={isSavingTestset}
                            >
                                Apply and Continue Editing
                            </Button>
                            <Dropdown
                                placement="topRight"
                                menu={{
                                    items: [
                                        ...(onOpenCommitModal
                                            ? [
                                                  {
                                                      key: "commit",
                                                      label: "Apply and Commit Changes",
                                                      onClick: handleOpenCommitModal,
                                                      disabled: !hasSessionDirty,
                                                  },
                                              ]
                                            : []),
                                        ...(onSaveTestset
                                            ? [
                                                  {
                                                      key: "save",
                                                      label: "Apply and Save Testset",
                                                      onClick: handleSaveTestset,
                                                      disabled: !hasSessionDirty,
                                                  },
                                              ]
                                            : []),
                                    ],
                                }}
                            >
                                <Button
                                    type="primary"
                                    icon={<CaretUp size={14} />}
                                    disabled={
                                        !hasSessionDirty || (!onOpenCommitModal && !onSaveTestset)
                                    }
                                />
                            </Dropdown>
                        </Space.Compact>
                    </div>
                )
            }
        >
            {open && testcaseId && (
                <>
                    {isLoading && (
                        <div className="p-6 space-y-4">
                            <Skeleton active paragraph={{rows: 8}} />
                        </div>
                    )}
                    {isError && (
                        <div className="p-6">
                            <Alert
                                type="error"
                                message="Failed to load testcase"
                                description={errorMessage ?? "Unknown error"}
                                showIcon
                            />
                        </div>
                    )}
                    {testcaseData &&
                        renderContent({
                            initialPath: drillInPath,
                            onPathChange: setDrillInPath,
                            rootViewMode,
                            collapseSignal,
                        })}
                    {testcaseData && testcaseId && renderOutputs?.(testcaseId)}
                    {testcaseData && testcaseId && renderEvaluatorMetrics?.(testcaseId)}
                </>
            )}
        </EnhancedDrawer>
    )
}

export default TestcaseDrawer
