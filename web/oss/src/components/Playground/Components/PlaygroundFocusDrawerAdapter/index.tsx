import {useCallback, useMemo, type ReactNode} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
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
const renderNoAddToQueue = () => null

const PlaygroundFocusDrawerAdapter = () => {
    const [{isOpen, rowId, entityId}, setDrawerState] = useAtom(playgroundFocusDrawerAtom)
    const closeDrawer = useSetAtom(closePlaygroundFocusDrawerAtom)

    const rowIds = useAtomValue(executionItemController.selectors.generationRowIds) as string[]

    const currentRowIndex = useMemo(() => (rowId ? rowIds.indexOf(rowId) : -1), [rowIds, rowId])

    const entityData = useAtomValue(testcaseMolecule.data(rowId ?? ""))

    const handlePrevious = useCallback(() => {
        if (currentRowIndex <= 0) return
        setDrawerState((prev) => ({...prev, rowId: rowIds[currentRowIndex - 1]}))
    }, [currentRowIndex, rowIds, setDrawerState])

    const handleNext = useCallback(() => {
        if (currentRowIndex < 0 || currentRowIndex >= rowIds.length - 1) return
        setDrawerState((prev) => ({...prev, rowId: rowIds[currentRowIndex + 1]}))
    }, [currentRowIndex, rowIds, setDrawerState])

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
            hasPrevious={currentRowIndex > 0}
            hasNext={currentRowIndex >= 0 && currentRowIndex < rowIds.length - 1}
            testcaseNumber={currentRowIndex >= 0 ? currentRowIndex + 1 : undefined}
            testcaseData={entityData ?? {}}
            isLoading={false}
            isError={false}
            isDirty={false}
            onRestoreSessionStart={noopRestore}
            renderContent={renderContent}
            renderOutputs={renderOutputs}
            renderAddToQueue={renderNoAddToQueue}
        />
    )
}

export default PlaygroundFocusDrawerAdapter
