import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {createT, useT} from "@agenta/i18n"
import testcaseCatalog from "@agenta/i18n/catalogs/entityUi.testcase"
import {copyToClipboard} from "@agenta/ui"
import {DropdownButton, type DropdownButtonOption} from "@agenta/ui/components"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ViewModeDropdown} from "@agenta/ui/drill-in"
import {
    Alert,
    Button,
    Skeleton,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
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

import type {RootDrawerViewMode} from "./codeFormat"

const EXPANDED_DRAWER_WIDTH = 1920

const tNow = createT(testcaseCatalog)

const rootViewOptions = (): {value: RootDrawerViewMode; label: string}[] => [
    {value: "form", label: tNow("entityUi.testcase.viewForm")},
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
    initialWidth,
    renderEvaluatorMetrics,
    enableRootViewMode = false,
}: TestcaseDrawerProps<TData>) {
    const t = useT(testcaseCatalog)
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

    const applyMenuOptions = useMemo<DropdownButtonOption[]>(
        () => [
            ...(onOpenCommitModal
                ? [
                      {
                          key: "commit",
                          label: tNow("entityUi.testcase.applyAndCommit"),
                          disabled: !hasSessionDirty,
                      },
                  ]
                : []),
            ...(onSaveTestset
                ? [
                      {
                          key: "save",
                          label: tNow("entityUi.testcase.applyAndSave"),
                          disabled: !hasSessionDirty,
                      },
                  ]
                : []),
        ],
        [onOpenCommitModal, onSaveTestset, hasSessionDirty],
    )

    const title = useMemo(
        () => (
            // TooltipProvider scopes the Radix tooltip context to the header cluster —
            // the only place this component renders tooltips.
            <TooltipProvider>
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={tNow("entityUi.testcase.closeDrawer")}
                            onClick={handleCancel}
                        >
                            <CaretDoubleRight size={14} />
                        </Button>
                        {showExpandButton && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={
                                            isDrawerExpanded
                                                ? tNow("entityUi.testcase.restoreWidth")
                                                : tNow("entityUi.testcase.expandDrawer")
                                        }
                                        onClick={() => setIsDrawerExpanded((value) => !value)}
                                    >
                                        {isDrawerExpanded ? (
                                            <CornersIn size={14} />
                                        ) : (
                                            <CornersOut size={14} />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isDrawerExpanded
                                        ? tNow("entityUi.testcase.restoreWidth")
                                        : tNow("entityUi.testcase.expandDrawer")}
                                </TooltipContent>
                            </Tooltip>
                        )}
                        {(onPrevious || onNext) && (
                            <div className="flex items-center">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={tNow("entityUi.testcase.previous")}
                                    disabled={!hasPrevious}
                                    onClick={onPrevious}
                                >
                                    <CaretUp size={14} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={tNow("entityUi.testcase.next")}
                                    disabled={!hasNext}
                                    onClick={onNext}
                                >
                                    <CaretDown size={14} />
                                </Button>
                            </div>
                        )}
                        <span className="font-medium text-sm">
                            {isNewRow
                                ? tNow("entityUi.testcase.newTestcase")
                                : tNow("entityUi.testcase.testcaseNumber", {
                                      number: testcaseNumber ?? "",
                                  })}
                        </span>
                        {!skipDeferredFlow && isDirty && (
                            <span className="text-[12px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                {tNow("entityUi.testcase.edited")}
                            </span>
                        )}
                        {testcaseId && !isNewRow && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={tNow("entityUi.testcase.copyId")}
                                        onClick={handleCopyId}
                                    >
                                        <Copy size={14} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isIdCopied
                                        ? tNow("entityUi.testcase.copiedId")
                                        : tNow("entityUi.testcase.copyId")}
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {enableRootViewMode && (
                            <>
                                {rootViewMode === "form" && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={handleCollapseAll}
                                                aria-label={tNow(
                                                    "entityUi.testcase.collapseAllFields",
                                                )}
                                            >
                                                <ArrowsInLineVertical size={14} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {tNow("entityUi.testcase.collapseAll")}
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={handleCopyPayload}
                                            aria-label={tNow("entityUi.testcase.copyPayload")}
                                        >
                                            {isPayloadCopied ? (
                                                <Check size={14} />
                                            ) : (
                                                <Copy size={14} />
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {isPayloadCopied
                                            ? tNow("entityUi.testcase.copied")
                                            : tNow("entityUi.testcase.copyTestcase")}
                                    </TooltipContent>
                                </Tooltip>
                                <ViewModeDropdown<RootDrawerViewMode>
                                    value={rootViewMode}
                                    options={rootViewOptions()}
                                    onChange={setRootViewMode}
                                />
                            </>
                        )}
                        {renderAddToQueue ? renderAddToQueue(queueItemIds) : null}
                    </div>
                </div>
            </TooltipProvider>
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
            afterOpenChange={afterOpenChange}
            destroyOnHidden
            styles={{
                body: {padding: "0px"},
                footer: {padding: "12px 24px", display: "flex", justifyContent: "flex-end"},
            }}
            footer={
                skipDeferredFlow ? null : (
                    <div className="w-full flex items-center justify-end gap-3">
                        <Button variant="outline" onClick={handleCancel}>
                            {t("entityUi.testcase.cancel")}
                        </Button>
                        {/* Split button (replaces antd Space.Compact + Dropdown) — main action
                         *  applies, the chevron menu holds commit/save variants. */}
                        <DropdownButton
                            label={t("entityUi.testcase.applyAndContinue")}
                            variant="default"
                            onClick={handleApply}
                            disabled={!hasSessionDirty}
                            loading={isSavingTestset}
                            dropdownDisabled={!onOpenCommitModal && !onSaveTestset}
                            placement="topRight"
                            dropdownIcon={<CaretUp size={14} />}
                            options={applyMenuOptions}
                            onOptionSelect={(key) => {
                                if (key === "commit") handleOpenCommitModal()
                                else if (key === "save") void handleSaveTestset()
                            }}
                        />
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
                                message={t("entityUi.testcase.loadFailed")}
                                description={errorMessage ?? t("entityUi.testcase.unknownError")}
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
