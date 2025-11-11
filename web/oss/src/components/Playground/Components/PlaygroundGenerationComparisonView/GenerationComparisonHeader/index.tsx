import {memo, useCallback} from "react"

import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"

import RunButton from "../../../assets/RunButton"
import usePlayground from "../../../hooks/usePlayground"
import {clearRuns} from "../../../hooks/usePlayground/assets/generationHelpers"
import {PlaygroundStateData} from "../../../hooks/usePlayground/types"
import TestsetDrawerButton from "../../Drawers/TestsetDrawer"
import LoadTestsetButton from "../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

import {useStyles} from "./styles"
import type {GenerationComparisonHeaderProps} from "./types"

const GenerationComparisonHeader = ({className}: GenerationComparisonHeaderProps) => {
    const classes = useStyles()

    const {resultHashes, isRunning, runTests, mutate} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const variants = state.variants.filter((variant) => state.selected.includes(variant.id))
            const resultHashes: any[] = []
            let isRunning

            if (variants[0].isChat) {
                const messageRows = state.generationData.messages.value

                messageRows.forEach((dataItem) => {
                    if (dataItem.history && Array.isArray(dataItem.history.value)) {
                        dataItem.history.value.forEach((historyItem) => {
                            if (historyItem.__runs) {
                                const runs = Object.values(historyItem.__runs)
                                for (const runData of runs) {
                                    isRunning = runs.some((runData) => runData?.__isRunning)
                                    resultHashes.push(runData?.__result)
                                }
                            }
                        })
                    }
                })

                return {resultHashes: resultHashes.filter(Boolean), isRunning: isRunning || false}
            } else {
                const inputRows = state.generationData.inputs.value

                inputRows.forEach((dataItem) => {
                    if (dataItem.__runs) {
                        const runs = Object.values(dataItem.__runs || {})
                        for (const runData of runs) {
                            isRunning = runs.some((runData) => runData?.__isRunning)

                            resultHashes.push(runData?.__result)
                        }
                    }
                })

                return {resultHashes: resultHashes.filter(Boolean), isRunning: isRunning || false}
            }
        }, []),
    })

    const clearGeneration = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState
                clearRuns(clonedState)
                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return (
        <section
            className={clsx(
                "flex items-center justify-between gap-2 px-4 py-2 h-[40px] flex-shrink-0",
                classes.header,
                className,
            )}
        >
            <Typography className={classes.heading}>Generations</Typography>

            <div className="flex items-center gap-2">
                <Tooltip title="Clear all">
                    <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                        Clear
                    </Button>
                </Tooltip>
                <TestsetDrawerButton
                    label="Add all to test set"
                    icon={false}
                    size="small"
                    disabled={isRunning}
                    resultHashes={resultHashes}
                    key={resultHashes.join("-")}
                />
                <LoadTestsetButton label="Load test set" />

                <RunButton isRunAll type="primary" onClick={() => runTests?.()} />
            </div>
        </section>
    )
}

export default memo(GenerationComparisonHeader)
