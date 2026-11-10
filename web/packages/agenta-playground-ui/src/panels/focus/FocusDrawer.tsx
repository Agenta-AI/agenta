import {useCallback, useMemo, type ReactNode} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    TestcaseDataEditor,
    TestcaseDrawer,
    useTestcaseDrawerNavigation,
    type TestcaseDrawerContentRenderProps,
} from "@agenta/entity-ui/testcase"
import {executionItemController} from "@agenta/playground"
import {atom, useAtom, useAtomValue, useSetAtom, useStore} from "jotai"

import {usePlaygroundTestcaseEditorModel} from "../../hooks/usePlaygroundTestcaseEditorModel"
import {closePlaygroundFocusDrawerAtom, playgroundFocusDrawerAtom} from "../../state/focusDrawer"
import {
    applyFocusDrawerPayloadEdit,
    buildFocusDrawerPayload,
    toFocusDrawerResultPayload,
} from "../../utils/focusDrawerPayload"

import {FocusOutputs} from "./FocusOutputs"

const INITIAL_WIDTH = 800
const getRowId = (id: string) => id

export interface FocusDrawerProps {
    renderTraceFooter?: (traceId: string) => ReactNode
    /** The header's "Add to queue" control for the open test case; none when absent. */
    renderAddToQueue?: (itemIds: string[]) => ReactNode
}

/**
 * One test case in a drawer: its inputs as a form, JSON or YAML, previous and next to move through
 * the rows, and its output under the form. Form edits write to the test case at once.
 */
export const FocusDrawer = ({renderTraceFooter, renderAddToQueue}: FocusDrawerProps) => {
    const [{isOpen, rowId, entityId}, setDrawer] = useAtom(playgroundFocusDrawerAtom)
    const close = useSetAtom(closePlaygroundFocusDrawerAtom)
    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)
    const rowIds = useAtomValue(executionItemController.selectors.generationRowIds) as string[]
    const {entityData, suggestedColumns, editorColumns, editorValue, handleEditorChange} =
        usePlaygroundTestcaseEditorModel(rowId ?? "")

    const payloadAtom = useMemo(
        () =>
            atom((get) => {
                if (!entityId) return {variants: []}
                const name = get(workflowMolecule.selectors.variantLabel(entityId))
                const result = rowId
                    ? get(executionItemController.selectors.fullResult({rowId, entityId}))
                    : null
                return {
                    variants: [
                        {
                            id: entityId,
                            name: name ?? "Prompt",
                            result: toFocusDrawerResultPayload(result),
                            downstream: [],
                        },
                    ],
                }
            }),
        [entityId, rowId],
    )
    // The JSON and YAML views show the outputs as they stood when the row opened. A live value
    // would rebuild the payload when a run ends, and the editor would drop an unfinished edit.
    // The output under the form stays live.
    const store = useStore()
    const outputs = useMemo(() => store.get(payloadAtom), [store, payloadAtom, isOpen])
    const payload = useMemo(
        () =>
            buildFocusDrawerPayload({
                inputs: entityData?.data ?? {},
                suggestedFields: suggestedColumns,
                outputs,
            }),
        [entityData?.data, outputs, suggestedColumns],
    )

    const moveTo = useCallback(
        (next: string) => setDrawer((previous) => ({...previous, rowId: next})),
        [setDrawer],
    )
    const {currentIndex, hasPrevious, hasNext, handlePrevious, handleNext} =
        useTestcaseDrawerNavigation<string>({
            rows: rowIds,
            getRowId,
            currentRowId: rowId,
            onNavigate: moveTo,
        })

    const handlePayloadChange = useCallback(
        (next: Record<string, unknown>) => {
            if (!rowId) return
            updateTestcase(rowId, {
                data: applyFocusDrawerPayloadEdit({
                    currentInputs: entityData?.data ?? {},
                    nextPayload: next,
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
            // The drawer renders outside the page: `data-playground` gives it the playground's
            // editor style (see the app's globals.css).
            if (rootViewMode !== "form") {
                return (
                    <div data-playground>
                        <TestcaseDataEditor
                            key={rowId}
                            value={payload}
                            onChange={handlePayloadChange}
                            mode="edit"
                            surface="drawer"
                            features={{typeChips: true, rootViewMode: false, columnMapping: false}}
                            rootViewMode={rootViewMode}
                        />
                    </div>
                )
            }
            return (
                <div data-playground className="flex flex-col gap-4">
                    <TestcaseDataEditor
                        key={rowId}
                        value={editorValue}
                        columns={editorColumns}
                        onChange={handleEditorChange}
                        mode="edit"
                        surface="playground"
                        initialPath={initialPath}
                        onPathChange={onPathChange}
                        features={{typeChips: true, rootViewMode: false, columnMapping: false}}
                        rootViewMode={rootViewMode}
                        collapseSignal={collapseSignal}
                    />
                    {entityId ? (
                        <FocusOutputs
                            rowId={rowId}
                            entityId={entityId}
                            renderTraceFooter={renderTraceFooter}
                        />
                    ) : null}
                </div>
            )
        },
        [
            editorColumns,
            editorValue,
            entityId,
            handleEditorChange,
            handlePayloadChange,
            payload,
            renderTraceFooter,
            rowId,
        ],
    )

    if (!rowId) return null
    return (
        <TestcaseDrawer
            open={isOpen}
            onClose={close}
            testcaseId={rowId}
            isNewRow={false}
            editMode="autoApply"
            initialWidth={INITIAL_WIDTH}
            onPrevious={handlePrevious}
            onNext={handleNext}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            testcaseNumber={currentIndex >= 0 ? currentIndex + 1 : undefined}
            testcaseData={payload}
            isLoading={false}
            isError={false}
            isDirty={false}
            renderContent={renderContent}
            renderAddToQueue={renderAddToQueue}
            enableRootViewMode
        />
    )
}
