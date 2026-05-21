import {useCallback, useMemo, type ReactNode} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {
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
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import PlaygroundTestcaseEditor from "../PlaygroundTestcaseEditor"

const INITIAL_WIDTH = 800

const EMPTY_DATA = {}

const getRowId = (id: string) => id

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

const PlaygroundFocusDrawerAdapter = () => {
    const [{isOpen, rowId, entityId}, setDrawerState] = useAtom(playgroundFocusDrawerAtom)
    const closeDrawer = useSetAtom(closePlaygroundFocusDrawerAtom)

    const rowIds = useAtomValue(executionItemController.selectors.generationRowIds) as string[]
    const loadableId = useAtomValue(playgroundController.selectors.loadableId()) as string
    const loadableMode = useAtomValue(
        useMemo(() => loadableController.selectors.mode(loadableId), [loadableId]),
    ) as "local" | "connected" | null
    const connectedSource = useAtomValue(
        useMemo(() => loadableController.selectors.connectedSource(loadableId), [loadableId]),
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
            testcaseData={EMPTY_DATA}
            isLoading={false}
            isError={false}
            isDirty={false}
            renderContent={renderContent}
            renderOutputs={renderOutputs}
            renderAddToQueue={shouldShowAddToQueue ? renderAddToQueue : undefined}
        />
    )
}

export default PlaygroundFocusDrawerAdapter
