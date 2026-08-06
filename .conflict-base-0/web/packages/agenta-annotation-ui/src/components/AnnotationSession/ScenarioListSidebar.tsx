/**
 * ScenarioListSidebar
 *
 * Left sidebar in the annotation session showing all scenarios
 * with status indicators and click-to-navigate functionality.
 */

import {memo, useCallback, useEffect, useRef} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {Check, Circle} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

// ============================================================================
// SCENARIO LIST ITEM
// ============================================================================

const ScenarioListItem = memo(function ScenarioListItem({
    index,
    scenarioId,
    isCurrent,
    isCompleted,
    serverStatus,
    onClick,
}: {
    index: number
    scenarioId: string
    isCurrent: boolean
    isCompleted: boolean
    serverStatus?: string | null
    onClick: (index: number) => void
}) {
    const ref = useRef<HTMLButtonElement>(null)

    // Scroll active item into view
    useEffect(() => {
        if (isCurrent && ref.current) {
            ref.current.scrollIntoView({block: "nearest", behavior: "smooth"})
        }
    }, [isCurrent])

    const handleClick = useCallback(() => onClick(index), [onClick, index])

    // Determine visual status
    const isDone = isCompleted || serverStatus === "success"

    return (
        <button
            ref={ref}
            onClick={handleClick}
            className={`
                flex items-center gap-2 px-3 py-2 w-full text-left border-none cursor-pointer transition-colors
                ${isCurrent ? "bg-[var(--ant-color-primary-bg)]" : "bg-transparent hover:bg-[var(--ant-color-fill-quaternary)]"}
            `}
        >
            {/* Status indicator */}
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                {isDone ? (
                    <Check size={14} weight="bold" className="text-green-600" />
                ) : (
                    <Circle
                        size={8}
                        weight="fill"
                        className={isCurrent ? "text-[var(--ant-color-primary)]" : "text-gray-300"}
                    />
                )}
            </span>

            {/* Scenario number */}
            <Typography.Text
                className={`text-xs ${isCurrent ? "font-medium" : ""}`}
                ellipsis
                title={`Scenario ${index + 1}`}
            >
                {index + 1}
            </Typography.Text>
        </button>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const ScenarioListSidebar = memo(function ScenarioListSidebar() {
    const scenarioIds = useAtomValue(annotationSessionController.selectors.scenarioIds())
    const currentIndex = useAtomValue(annotationSessionController.selectors.currentScenarioIndex())
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const scenarioStatuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)

    const handleItemClick = useCallback(
        (index: number) => {
            navigateToIndex(index)
        },
        [navigateToIndex],
    )

    return (
        <div className="flex flex-col h-full border-r border-solid border-[var(--ant-color-border-secondary)] w-[60px] min-w-[60px]">
            {/* Header */}
            <div className="px-2 py-3 border-b border-solid border-[var(--ant-color-border-secondary)] text-center">
                <Typography.Text type="secondary" className="text-[10px]">
                    {progress.completed}/{progress.total}
                </Typography.Text>
            </div>

            {/* Scenario list */}
            <div className="flex-1 overflow-y-auto">
                {scenarioIds.map((id, index) => {
                    const status = scenarioStatuses[id]
                    const isDone = status === "success"

                    return (
                        <ScenarioListItem
                            key={id}
                            index={index}
                            scenarioId={id}
                            isCurrent={index === currentIndex}
                            isCompleted={isDone}
                            serverStatus={status}
                            onClick={handleItemClick}
                        />
                    )
                })}
            </div>
        </div>
    )
})

export default ScenarioListSidebar
