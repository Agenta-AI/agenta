/**
 * TestsetDropdown
 *
 * Renders a dropdown button in the execution header for testset management.
 * Adapts based on whether the playground is connected to a local or API-backed testset.
 *
 * State 1 — Local testset (default):
 *   Button: "Testset ▼"
 *   Menu:   • Connect testset → opens TestsetSelectionModal (load mode)
 *           • Add to testset  → opens AddToTestsetDrawer with current run results
 *
 * State 2 — Connected to API-backed testset:
 *   Button: "<testset_name> ▼"
 *   Menu:   • Sync changes (disabled when no changes)
 *           • Manage testcases → opens TestsetSelectionModal (edit mode)
 *           • Change testset  → opens TestsetSelectionModal (load mode)
 *           • Add to testset  → opens AddToTestsetDrawer with current run results
 *           • Disconnect (danger)
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import type {CommitModeOption, CommitSubmitParams, CommitSubmitResult} from "@agenta/entity-ui"
import {EntityCommitModal} from "@agenta/entity-ui"
import {playgroundController} from "@agenta/playground"
import {
    executionByMessageIdAtomFamily,
    isChatModeAtom,
    resultsByKeyAtomFamily,
    type MessageExecution,
} from "@agenta/playground/state"
import {
    TestsetSelectionModal,
    type PreviewPanelRenderProps,
    type TestsetSelectionMode,
    type TestsetSelectionPayload,
} from "@agenta/playground-ui/components"
import {
    ArrowsLeftRightIcon,
    CaretDownIcon,
    DatabaseIcon,
    LinkIcon,
    ListBulletsIcon,
    Plus,
    XCircleIcon,
} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {Button, Dropdown, Input, Typography, message} from "antd"
import {atom, useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"

import {
    extractRootSpanIdFromTraceData,
    toTestsetTraceReference,
    type TestsetTraceReference,
} from "@/oss/lib/traces/traceUtils"
import {saveNewTestsetAtom} from "@/oss/state/entities/testset/mutations"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {CreateTestsetCardWrapper} from "./CreateTestsetCardWrapper"
import {TestsetPreviewPanelWrapper} from "./TestsetPreviewPanelWrapper"

// ── Lazy-loaded AddToTestset drawer ────────────────────────────────────────
const TestsetDrawer = dynamic(
    () => import("@/oss/components/SharedDrawers/AddToTestsetDrawer/TestsetDrawer"),
)

// ============================================================================
// CONSTANTS
// ============================================================================

const COMMIT_MODES: CommitModeOption[] = [
    {id: "commit", label: "Commit changes"},
    {id: "save-new", label: "Save as new testset"},
]

// ============================================================================
// SYNC MODE CONTENT
// Helper component that syncs the current commit mode to parent state via useEffect.
// This avoids calling setState during render (renderModeContent is called during render).
// ============================================================================

interface SyncModeContentProps {
    mode: string | undefined
    onModeChange: (mode: string) => void
    newTestsetName: string
    onNameChange: (name: string) => void
}

function SyncModeContent({mode, onModeChange, newTestsetName, onNameChange}: SyncModeContentProps) {
    useEffect(() => {
        if (mode) onModeChange(mode)
    }, [mode, onModeChange])

    if (mode !== "save-new") return null

    return (
        <div className="flex flex-col gap-1 pt-1">
            <Typography.Text className="text-xs text-[var(--ant-color-text-secondary)]">
                Testset name
            </Typography.Text>
            <Input
                placeholder="Enter testset name"
                value={newTestsetName}
                onChange={(e) => onNameChange(e.target.value)}
                autoFocus
            />
        </div>
    )
}

// ============================================================================
// TESTSET DROPDOWN COMPONENT
// ============================================================================

export function TestsetDropdown() {
    // ── Atoms ──────────────────────────────────────────────────────────────
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null

    const connectedSource = useAtomValue(
        useMemo(
            () =>
                loadableId
                    ? loadableController.selectors.connectedSource(loadableId)
                    : ({read: () => null} as never),
            [loadableId],
        ),
    ) as {id: string | null; name: string | null} | null

    const mode = useAtomValue(
        useMemo(
            () =>
                loadableId
                    ? loadableController.selectors.mode(loadableId)
                    : ({read: () => "local"} as never),
            [loadableId],
        ),
    ) as "local" | "connected"

    const hasLocalChanges = useAtomValue(
        useMemo(
            () =>
                loadableId
                    ? loadableController.selectors.hasLocalChanges(loadableId)
                    : ({read: () => false} as never),
            [loadableId],
        ),
    ) as boolean

    // ── Actions ────────────────────────────────────────────────────────────
    const connectToTestset = useSetAtom(playgroundController.actions.connectToTestset)
    const importTestcases = useSetAtom(playgroundController.actions.importTestcases)
    const disconnectAndReset = useSetAtom(playgroundController.actions.disconnectAndResetToLocal)
    const updateTestcaseSelection = useSetAtom(loadableController.actions.updateTestcaseSelection)
    const commitChanges = useSetAtom(loadableController.actions.commitChanges)
    const saveAsNewTestset = useSetAtom(loadableController.actions.saveAsNewTestset)
    const setLoadableName = useSetAtom(loadableController.actions.setName)
    const initSelectionDraft = useSetAtom(testcaseMolecule.actions.initSelectionDraft)
    const saveNewTestset = useSetAtom(saveNewTestsetAtom)
    const store = useStore()

    // ── Derived state ──────────────────────────────────────────────────────
    const isConnected = mode === "connected"
    const revisionId = connectedSource?.id ?? null
    const testsetName = connectedSource?.name ?? null
    const buttonLabel = isConnected && testsetName ? testsetName : "Testset"

    // ── Add-to-testset: reactive success check ─────────────────────────────
    // Tracks whether there are any successful run results (with a trace) to add
    const hasSuccessfulResults = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    if (!loadableId) return false
                    const allResults = get(resultsByKeyAtomFamily(loadableId))
                    const hasCompletionResults = Object.values(allResults).some(
                        (r) => r?.status === "success" && !!r?.traceId,
                    )

                    if (hasCompletionResults) return true

                    const isChat = get(isChatModeAtom)
                    if (isChat) {
                        const chatExecutions = get(executionByMessageIdAtomFamily(loadableId))
                        return Object.values(
                            chatExecutions as Record<string, MessageExecution>,
                        ).some(
                            (r) =>
                                (r?.status === "complete" || r?.status === "success") &&
                                !!r?.traceId,
                        )
                    }

                    return false
                }),
            [loadableId],
        ),
    )

    // ── Add-to-testset drawer state ────────────────────────────────────────
    const [addToTestsetOpen, setAddToTestsetOpen] = useState(false)
    const [testsetTraceReferences, setTestsetTraceReferences] = useState<TestsetTraceReference[]>(
        [],
    )

    const testsetSpanIds = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    const spanIds: string[] = []
                    const seen = new Set<string>()

                    testsetTraceReferences.forEach(({traceId, spanId}) => {
                        const resolvedSpanId =
                            spanId ||
                            (traceId
                                ? extractRootSpanIdFromTraceData(
                                      traceId,
                                      get(loadableController.selectors.traceData(traceId)),
                                  )
                                : null)

                        if (!resolvedSpanId || seen.has(resolvedSpanId)) return

                        seen.add(resolvedSpanId)
                        spanIds.push(resolvedSpanId)
                    })

                    return spanIds
                }),
            [testsetTraceReferences],
        ),
    )

    const handleAddToTestset = useCallback(() => {
        if (!loadableId) return
        const allResults = store.get(resultsByKeyAtomFamily(loadableId))
        const completionTraceReferences = Object.values(allResults)
            .filter((r) => r?.status === "success" && !!r?.traceId)
            .map(toTestsetTraceReference)
            .filter((reference): reference is TestsetTraceReference => !!reference)

        let chatTraceReferences: TestsetTraceReference[] = []
        const isChat = store.get(isChatModeAtom)
        if (isChat) {
            const chatExecutions = store.get(executionByMessageIdAtomFamily(loadableId))
            chatTraceReferences = Object.values(chatExecutions as Record<string, MessageExecution>)
                .filter(
                    (r) => (r?.status === "complete" || r?.status === "success") && !!r?.traceId,
                )
                .map(toTestsetTraceReference)
                .filter((reference): reference is TestsetTraceReference => !!reference)
        }

        setTestsetTraceReferences([...completionTraceReferences, ...chatTraceReferences])
        setAddToTestsetOpen(true)
    }, [loadableId, store])

    const handleAddToTestsetClose = useCallback(() => {
        setAddToTestsetOpen(false)
        setTestsetTraceReferences([])
    }, [])

    // ── TestsetSelectionModal state ─────────────────────────────────────────
    // null = closed, "load" = connect/change, "edit" = manage testcases
    const [selectionModalMode, setSelectionModalMode] = useState<TestsetSelectionMode | null>(null)

    // ── Load/Change mode: connect or replace testset ───────────────────────
    const handleLoadConfirm = useCallback(
        (payload: TestsetSelectionPayload) => {
            if (!loadableId) {
                setSelectionModalMode(null)
                return
            }

            if (payload.importMode === "import") {
                // Import mode: add selected testcases without changing connection
                importTestcases({
                    loadableId,
                    testcases: payload.testcases ?? [],
                    jsonValueMode: payload.jsonValueMode,
                })
            } else {
                // Replace mode: connect and sync selected testcases from entity layer
                const testcases = payload.selectedTestcaseIds.map((id) => {
                    const data = testcaseMolecule.get.data(id)
                    return data ? {...(data as Record<string, unknown>)} : {id}
                })
                connectToTestset({
                    loadableId,
                    revisionId: payload.revisionId,
                    testcases,
                    testsetName: payload.testsetName ?? "",
                    testsetId: payload.testsetId ?? null,
                    revisionVersion: payload.revisionVersion ?? null,
                    jsonValueMode: payload.jsonValueMode,
                })
            }

            setSelectionModalMode(null)
        },
        [loadableId, connectToTestset, importTestcases],
    )

    // ── Edit mode: update visible rows without changing connection ─────────
    const handleEditConfirm = useCallback(
        (payload: TestsetSelectionPayload) => {
            if (!loadableId) return

            if (payload.importMode === "import" && payload.testcases) {
                importTestcases({
                    loadableId,
                    testcases: payload.testcases,
                    jsonValueMode: payload.jsonValueMode,
                })
            } else {
                // Edit mode returns the newly selected set, which updateTestcaseSelection diffs against
                updateTestcaseSelection(loadableId, payload.selectedTestcaseIds)
            }
            setSelectionModalMode(null)
        },
        [loadableId, updateTestcaseSelection, importTestcases],
    )

    const handleManageTestcasesClick = useCallback(() => {
        if (!loadableId) return
        const draftKey = connectedSource?.id || loadableId
        const displayRowIds = store.get(loadableController.selectors.displayRowIds(loadableId))
        initSelectionDraft(draftKey, displayRowIds)
        setSelectionModalMode("edit")
    }, [loadableId, connectedSource?.id, store, initSelectionDraft])

    const handleSelectionCancel = useCallback(() => setSelectionModalMode(null), [])

    // ── Create & Load: persist a brand-new testset via saveNewTestsetAtom ───
    const handleCreateAndLoad = useCallback(
        async ({testsetName, commitMessage}: {testsetName: string; commitMessage: string}) => {
            if (!loadableId) return {success: false as const}

            const projectId = store.get(projectIdAtom) as string | null

            if (!projectId) {
                message.error("Project ID not found")
                return {success: false as const}
            }

            const result = await saveNewTestset({
                projectId,
                testsetName,
            })

            if (result.success && result.revisionId && result.testsetId) {
                // Connect the newly created testset
                const testcases = result.testcases ?? []
                connectToTestset({
                    loadableId,
                    revisionId: result.revisionId,
                    testcases,
                    testsetName,
                    testsetId: result.testsetId,
                    revisionVersion: null,
                })
                message.success(`Test set "${testsetName}" created successfully`)
                return {
                    success: true as const,
                    revisionId: result.revisionId,
                    testsetId: result.testsetId,
                }
            }

            message.error(result.error?.message ?? "Failed to create test set")
            return {success: false as const}
        },
        [loadableId, store, saveNewTestset, connectToTestset],
    )

    // ── Disconnect ─────────────────────────────────────────────────────────
    const handleDisconnect = useCallback(() => {
        if (!loadableId) return
        disconnectAndReset(loadableId)
    }, [loadableId, disconnectAndReset])

    // ── Sync changes (EntityCommitModal) ───────────────────────────────────
    const [syncOpen, setSyncOpen] = useState(false)
    const [newTestsetName, setNewTestsetName] = useState("")
    const [currentSyncMode, setCurrentSyncMode] = useState("commit")
    const syncModeRef = useRef("commit")

    const handleModeChange = useCallback((m: string) => {
        if (syncModeRef.current !== m) {
            syncModeRef.current = m
            setCurrentSyncMode(m)
        }
    }, [])

    const syncSubmitLabel = currentSyncMode === "save-new" ? "Save" : "Commit"

    const handleSyncOpen = useCallback(() => {
        setNewTestsetName("")
        setCurrentSyncMode("commit")
        syncModeRef.current = "commit"
        setSyncOpen(true)
    }, [])

    const handleSyncSubmit = useCallback(
        async ({message, mode: submitMode}: CommitSubmitParams): Promise<CommitSubmitResult> => {
            if (!loadableId) return {success: false, error: "No loadable ID"}

            if (submitMode === "save-new") {
                const trimmedName = newTestsetName.trim()
                if (!trimmedName) {
                    return {success: false, error: "Testset name is required"}
                }
                setLoadableName(loadableId, trimmedName)
                const result = await saveAsNewTestset(loadableId)
                return result.success
                    ? {success: true}
                    : {success: false, error: result.error?.message ?? "Failed to save"}
            }

            try {
                await commitChanges(loadableId, message)
                return {success: true}
            } catch (err) {
                return {success: false, error: err instanceof Error ? err.message : String(err)}
            }
        },
        [loadableId, newTestsetName, commitChanges, saveAsNewTestset, setLoadableName],
    )

    const canSyncSubmit = useCallback(
        ({mode: m}: {mode?: string}) => {
            if (m === "save-new") return newTestsetName.trim().length > 0
            return true
        },
        [newTestsetName],
    )

    const renderSyncModeContent = useCallback(
        ({mode: m}: {mode?: string}) => (
            <SyncModeContent
                mode={m}
                onModeChange={handleModeChange}
                newTestsetName={newTestsetName}
                onNameChange={setNewTestsetName}
            />
        ),
        [handleModeChange, newTestsetName],
    )

    // ── Dropdown menu ──────────────────────────────────────────────────────
    const menuItems = useMemo<MenuProps["items"]>(() => {
        if (!isConnected) {
            return [
                {
                    key: "connect",
                    icon: <LinkIcon size={14} />,
                    label: "Connect testset",
                    onClick: () => setSelectionModalMode("load"),
                },
                {type: "divider"},
                {
                    key: "add-to-testset",
                    icon: <Plus size={14} />,
                    label: "Add to testset",
                    disabled: !hasSuccessfulResults,
                    onClick: handleAddToTestset,
                },
            ]
        }

        return [
            {
                key: "sync",
                icon: <DatabaseIcon size={14} />,
                label: "Sync changes",
                disabled: !hasLocalChanges,
                onClick: handleSyncOpen,
            },
            {type: "divider"},
            {
                key: "manage",
                icon: <ListBulletsIcon size={14} />,
                label: "Manage testcases",
                onClick: handleManageTestcasesClick,
            },
            {
                key: "change",
                icon: <ArrowsLeftRightIcon size={14} />,
                label: "Change testset",
                onClick: () => setSelectionModalMode("load"),
            },
            {
                key: "add-to-testset",
                icon: <Plus size={14} />,
                label: "Add to testset",
                disabled: !hasSuccessfulResults,
                onClick: handleAddToTestset,
            },
            {type: "divider"},
            {
                key: "disconnect",
                icon: <XCircleIcon size={14} />,
                label: "Disconnect",
                danger: true,
                onClick: handleDisconnect,
            },
        ]
    }, [
        isConnected,
        hasLocalChanges,
        hasSuccessfulResults,
        handleSyncOpen,
        handleDisconnect,
        handleAddToTestset,
    ])

    if (!loadableId) return null

    return (
        <>
            <Dropdown menu={{items: menuItems}} trigger={["click"]} placement="bottomRight">
                <Button
                    size="small"
                    icon={<DatabaseIcon size={14} />}
                    className="flex items-center gap-1 max-w-[160px]"
                >
                    <span className="truncate">{buttonLabel}</span>
                    <CaretDownIcon size={12} />
                </Button>
            </Dropdown>

            {/* Connect / Change testset modal (load mode) */}
            {selectionModalMode === "load" && (
                <TestsetSelectionModal
                    open
                    loadableId={loadableId}
                    connectedRevisionId={revisionId ?? undefined}
                    mode="load"
                    onConfirm={handleLoadConfirm}
                    onCancel={handleSelectionCancel}
                    renderCreateCard={(props) => <CreateTestsetCardWrapper {...props} />}
                    renderPreviewPanel={(props: PreviewPanelRenderProps) => (
                        <TestsetPreviewPanelWrapper {...props} />
                    )}
                    onCreateAndLoad={handleCreateAndLoad}
                />
            )}

            {/* Manage testcases modal (edit mode) */}
            {selectionModalMode === "edit" && (
                <TestsetSelectionModal
                    open
                    loadableId={loadableId}
                    connectedRevisionId={revisionId ?? undefined}
                    mode="edit"
                    onConfirm={handleEditConfirm}
                    onCancel={handleSelectionCancel}
                />
            )}

            {/* Sync changes modal */}
            <EntityCommitModal
                open={syncOpen}
                onClose={() => setSyncOpen(false)}
                entity={
                    revisionId
                        ? {
                              type: "revision",
                              id: revisionId,
                              name: testsetName ?? "Testset",
                              metadata: {loadableId},
                          }
                        : undefined
                }
                onSubmit={handleSyncSubmit}
                commitModes={COMMIT_MODES}
                defaultCommitMode="commit"
                renderModeContent={renderSyncModeContent}
                canSubmit={canSyncSubmit}
                submitLabel={syncSubmitLabel}
                successMessage="Testset updated successfully"
            />

            {/* Add to testset drawer — mounted only when open to avoid isDrawerOpenAtom conflicts */}
            {addToTestsetOpen && (
                <TestsetDrawer
                    open={addToTestsetOpen}
                    spanIds={testsetSpanIds}
                    showSelectedSpanText={false}
                    onClose={handleAddToTestsetClose}
                />
            )}
        </>
    )
}

export default TestsetDropdown
