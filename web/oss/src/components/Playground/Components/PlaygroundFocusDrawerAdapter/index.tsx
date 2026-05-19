import {useCallback, type ReactNode} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {
    TestcaseDrawer,
    useTestcaseDrawerNavigation,
    type TestcaseDrawerContentRenderProps,
} from "@agenta/entity-ui/testcase"
import {executionItemController} from "@agenta/playground"
import {PlaygroundOutputs} from "@agenta/playground-ui/components"
import {
    closePlaygroundFocusDrawerAtom,
    playgroundFocusDrawerAtom,
} from "@agenta/playground-ui/state"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import PlaygroundTestcaseEditor from "../PlaygroundTestcaseEditor"

const INITIAL_WIDTH = 800

const noopRestore = () => {}

const getRowId = (id: string) => id

const PlaygroundFocusDrawerAdapter = () => {
    const [{isOpen, rowId, entityId}, setDrawerState] = useAtom(playgroundFocusDrawerAtom)
    const closeDrawer = useSetAtom(closePlaygroundFocusDrawerAtom)

    const rowIds = useAtomValue(executionItemController.selectors.generationRowIds) as string[]

    const entityData = useAtomValue(testcaseMolecule.data(rowId ?? ""))

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

    const renderContent = useCallback(
        (_props: TestcaseDrawerContentRenderProps): ReactNode => {
            if (!rowId) return null
            return <PlaygroundTestcaseEditor testcaseId={rowId} />
        },
        [rowId],
    )

    const renderOutputs = useCallback((): ReactNode => {
        if (!rowId || !entityId) return null
        return <PlaygroundOutputs rowId={rowId} primaryEntityId={entityId} />
    }, [rowId, entityId])

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
            testcaseData={entityData ?? {}}
            isLoading={false}
            isError={false}
            isDirty={false}
            onRestoreSessionStart={noopRestore}
            renderContent={renderContent}
            renderOutputs={renderOutputs}
        />
    )
}

export default PlaygroundFocusDrawerAdapter
