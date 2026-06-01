import {useCallback, type ReactNode} from "react"

import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
import {ListChecks} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import TestcaseEditDrawerContent from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/index"
import {testcase} from "@/oss/state/entities/testcase"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

interface TestcaseEditDrawerProps {
    open: boolean
    onClose: () => void
    testcaseId: string | null
    columns: Column[]
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
    /** Optional evaluator-metric renderer (forwarded to the drawer shell). */
    renderEvaluatorMetrics?: (testcaseId: string) => ReactNode
}

const TestcaseEditDrawer = ({
    testcaseId,
    columns,
    isNewRow,
    onClose,
    ...rest
}: TestcaseEditDrawerProps) => {
    const entityId = testcaseId || ""
    const testcaseData = useAtomValue(testcase.selectors.data(entityId))
    const queryState = useAtomValue(testcase.selectors.query(entityId))
    const isDirty = useAtomValue(testcase.selectors.isDirty(entityId))
    const dispatch = useSetAtom(testcase.controller(entityId))

    const handleRestoreSessionStart = useCallback(
        (data: FlattenedTestcase) => {
            dispatch({type: "update", changes: data})
        },
        [dispatch],
    )

    const renderContent = useCallback(
        ({
            initialPath,
            onPathChange,
            rootViewMode,
            collapseSignal,
        }: TestcaseDrawerContentRenderProps): ReactNode => (
            <TestcaseEditDrawerContent
                key={testcaseId}
                testcaseId={testcaseId!}
                columns={columns}
                isNewRow={isNewRow}
                initialPath={initialPath}
                onPathChange={onPathChange}
                rootViewMode={rootViewMode}
                collapseSignal={collapseSignal}
            />
        ),
        [testcaseId, columns, isNewRow],
    )

    const renderAddToQueue = useCallback(
        (itemIds: string[]) => (
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

    return (
        <TestcaseDrawer
            {...rest}
            onClose={onClose}
            testcaseId={testcaseId}
            isNewRow={isNewRow}
            testcaseData={testcaseData}
            isLoading={queryState.isPending}
            isError={queryState.isError}
            errorMessage={queryState.error?.message}
            isDirty={isDirty}
            onRestoreSessionStart={handleRestoreSessionStart}
            renderContent={renderContent}
            renderAddToQueue={renderAddToQueue}
            enableRootViewMode
        />
    )
}

export default TestcaseEditDrawer
