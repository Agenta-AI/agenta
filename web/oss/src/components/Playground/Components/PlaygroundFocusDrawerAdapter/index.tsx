import {useCallback, useMemo, type ReactNode} from "react"

import {loadableController} from "@agenta/entities/loadable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    TestcaseDataEditor,
    TestcaseDrawer,
    useTestcaseDrawerNavigation,
    type TestcaseDrawerContentRenderProps,
} from "@agenta/entity-ui/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {PlaygroundOutputs} from "@agenta/playground-ui/components"
import {
    closePlaygroundFocusDrawerAtom,
    playgroundFocusDrawerAtom,
} from "@agenta/playground-ui/state"
import {ListChecks} from "@phosphor-icons/react"
import {Button} from "antd"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import PlaygroundTestcaseEditor, {
    usePlaygroundTestcaseEditorModel,
} from "../PlaygroundTestcaseEditor"

import {
    applyPlaygroundDrawerPayloadEdit,
    buildPlaygroundDrawerPayload,
    toPlaygroundDrawerResultPayload,
    type PlaygroundDrawerOutputNodePayload,
} from "./drawerPayload"

const INITIAL_WIDTH = 800

const getRowId = (id: string) => id

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

const PlaygroundFocusDrawerAdapter = () => {
    const [{isOpen, rowId, entityId}, setDrawerState] = useAtom(playgroundFocusDrawerAtom)
    const closeDrawer = useSetAtom(closePlaygroundFocusDrawerAtom)
    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)

    const rowIds = useAtomValue(executionItemController.selectors.generationRowIds) as string[]
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null
    const loadableId = useAtomValue(playgroundController.selectors.loadableId()) as string
    const loadableMode = useAtomValue(
        useMemo(() => loadableController.selectors.mode(loadableId), [loadableId]),
    ) as "local" | "connected" | null
    const connectedSource = useAtomValue(
        useMemo(() => loadableController.selectors.connectedSource(loadableId), [loadableId]),
    )
    const {entityData, suggestedColumns} = usePlaygroundTestcaseEditorModel(rowId ?? "")

    const outputPayloadAtom = useMemo(
        () =>
            atom((get) => {
                const names: Record<string, string> = {}
                for (const node of nodes ?? []) {
                    const data = get(workflowMolecule.selectors.data(node.entityId))
                    names[node.id] = data?.name ?? node.entityType
                }

                const rootNodes = (nodes ?? []).filter((node) => node.depth === 0)
                const visibleRootNodes =
                    rootNodes.length > 0
                        ? rootNodes
                        : entityId
                          ? [
                                {
                                    id: entityId,
                                    entityId,
                                    entityType: "workflow",
                                    depth: 0,
                                } as PlaygroundNode,
                            ]
                          : []
                const isChain = (nodes?.length ?? 0) > 1

                const buildNodePayload = (
                    node: PlaygroundNode,
                    scopedEntityId: string,
                ): PlaygroundDrawerOutputNodePayload => ({
                    id: node.entityId,
                    name: names[node.id] ?? node.entityType,
                    result: toPlaygroundDrawerResultPayload(
                        rowId
                            ? get(
                                  executionItemController.selectors.fullResult({
                                      rowId,
                                      entityId: scopedEntityId,
                                  }),
                              )
                            : null,
                    ),
                    downstream: [],
                })

                return {
                    variants: visibleRootNodes.map((rootNode) => {
                        const downstreamNodes = isChain
                            ? (nodes ?? []).filter(
                                  (node) => node.depth > 0 && node.entityId !== rootNode.entityId,
                              )
                            : []

                        return {
                            ...buildNodePayload(rootNode, rootNode.entityId),
                            downstream: downstreamNodes.map((node) =>
                                buildNodePayload(node, `${rootNode.entityId}:${node.entityId}`),
                            ),
                        }
                    }),
                }
            }),
        [entityId, nodes, rowId],
    )
    const outputs = useAtomValue(outputPayloadAtom)
    const drawerPayload = useMemo(
        () =>
            buildPlaygroundDrawerPayload({
                inputs: entityData?.data ?? {},
                suggestedFields: suggestedColumns,
                outputs,
            }),
        [entityData?.data, outputs, suggestedColumns],
    )

    const navigateToRow = useCallback(
        (nextRowId: string) => setDrawerState((prev) => ({...prev, rowId: nextRowId})),
        [setDrawerState],
    )

    const {currentIndex, hasPrevious, hasNext, handlePrevious, handleNext} =
        useTestcaseDrawerNavigation<string>({
            rows: rowIds,
            getRowId,
            currentRowId: rowId,
            onNavigate: navigateToRow,
        })

    const handleRawPayloadChange = useCallback(
        (nextPayload: Record<string, unknown>) => {
            if (!rowId) return
            updateTestcase(rowId, {
                data: applyPlaygroundDrawerPayloadEdit({
                    currentInputs: entityData?.data ?? {},
                    nextPayload,
                }),
            })
        },
        [entityData?.data, rowId, updateTestcase],
    )

    const renderContent = useCallback(
        ({
            initialPath,
            onPathChange,
            rootViewMode,
            collapseSignal,
        }: TestcaseDrawerContentRenderProps): ReactNode => {
            if (!rowId) return null

            if (rootViewMode !== "form") {
                return (
                    <div className="w-full">
                        <TestcaseDataEditor
                            value={drawerPayload}
                            onChange={handleRawPayloadChange}
                            mode="edit"
                            surface="drawer"
                            features={{
                                typeChips: true,
                                rootViewMode: false,
                                columnMapping: false,
                            }}
                            rootViewMode={rootViewMode}
                        />
                    </div>
                )
            }

            return (
                <div className="flex flex-col">
                    <PlaygroundTestcaseEditor
                        testcaseId={rowId}
                        initialPath={initialPath}
                        onPathChange={onPathChange}
                        rootViewMode={rootViewMode}
                        collapseSignal={collapseSignal}
                    />
                    {entityId ? (
                        <PlaygroundOutputs rowId={rowId} primaryEntityId={entityId} />
                    ) : null}
                </div>
            )
        },
        [drawerPayload, entityId, handleRawPayloadChange, rowId],
    )

    const renderAddToQueue = useCallback(
        (itemIds: string[]): ReactNode => (
            <AddToQueuePopover
                itemType="testcases"
                itemIds={itemIds}
                disabled={itemIds.length === 0}
            >
                <Button
                    size="small"
                    icon={<ListChecks size={14} />}
                    disabled={itemIds.length === 0}
                >
                    Add to queue
                </Button>
            </AddToQueuePopover>
        ),
        [],
    )

    const shouldShowAddToQueue =
        loadableMode === "connected" && connectedSource?.type === "testcase"

    if (!rowId) return null

    return (
        <TestcaseDrawer
            open={isOpen}
            onClose={closeDrawer}
            testcaseId={rowId}
            isNewRow={false}
            editMode="autoApply"
            closeOnLayoutClick
            initialWidth={INITIAL_WIDTH}
            onPrevious={handlePrevious}
            onNext={handleNext}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            testcaseNumber={currentIndex >= 0 ? currentIndex + 1 : undefined}
            testcaseData={drawerPayload}
            isLoading={false}
            isError={false}
            isDirty={false}
            renderContent={renderContent}
            renderAddToQueue={shouldShowAddToQueue ? renderAddToQueue : undefined}
            enableRootViewMode
        />
    )
}

export default PlaygroundFocusDrawerAdapter
