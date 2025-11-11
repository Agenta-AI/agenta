import {memo, RefObject, useRef} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {FixedSizeList as List} from "react-window"
import {useResizeObserver} from "usehooks-ts"

import {
    displayedScenarioIdsFamily,
    evalAtomStore,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import EvalRunScenario from "../EvalRunScenario"
import ScenarioLoadingIndicator from "../ScenarioLoadingIndicator/ScenarioLoadingIndicator"

import {ITEM_GAP, ITEM_SIZE, ITEM_WIDTH} from "./assets/constants"

/**
 * Horizontal scroll list of `EvalRunScenario` cards with a shared loading indicator.
 * Extracted clean version after refactor. No duplicated legacy code.
 */
const EvalRunScenarioCards = ({runId}: {runId: string}) => {
    const store = evalAtomStore()
    const scenarioIds = useAtomValue(displayedScenarioIdsFamily(runId), {store}) || []

    const containerRef = useRef<HTMLDivElement | null>(null)
    const {width = 0, height = 0} = useResizeObserver({
        ref: containerRef as RefObject<HTMLDivElement>,
        box: "border-box",
    })

    return (
        <div
            className={clsx(
                "grow flex flex-col gap-4 min-h-0 w-full h-full",
                "[&_.ant-spin-container]:h-full",
            )}
        >
            <div className="flex items-center gap-4">
                <Typography.Title level={4} className="shrink-0 !m-0">
                    All Scenarios
                </Typography.Title>
                <ScenarioLoadingIndicator runId={runId} />
            </div>

            <div ref={containerRef} className="w-full h-full">
                {width > 0 && height > 0 && (
                    <List
                        layout="horizontal"
                        itemCount={scenarioIds.length}
                        itemSize={ITEM_SIZE}
                        height={height}
                        width={width}
                        itemKey={(index) => scenarioIds[index]}
                    >
                        {({index, style}) => (
                            <div
                                style={{
                                    ...style,
                                    width: ITEM_WIDTH,
                                    marginRight: index === scenarioIds.length - 1 ? 0 : ITEM_GAP,
                                }}
                            >
                                <EvalRunScenario scenarioId={scenarioIds[index]} runId={runId} />
                            </div>
                        )}
                    </List>
                )}
            </div>
        </div>
    )
}

export default memo(EvalRunScenarioCards)
