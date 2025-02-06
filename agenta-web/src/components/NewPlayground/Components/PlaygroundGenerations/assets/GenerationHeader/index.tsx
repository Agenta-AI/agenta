import {useCallback} from "react"

import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"

import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

import {useStyles} from "./styles"
import RunButton from "../../../../assets/RunButton"
import {clearRuns} from "../../../../hooks/usePlayground/assets/generationHelpers"
import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import LoadTestsetButton from "../../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

import type {PlaygroundStateData} from "../../../../hooks/usePlayground/types"
import type {GenerationHeaderProps} from "./types"
import {findVariantById} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
    const classes = useStyles()
    const {resultHashes, isRunning, mutate, runTests} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const variant = findVariantById(state, variantId)

                if (variant?.isChat) {
                    const messageRows = state.generationData.messages.value

                    const resultHashes = messageRows
                        .flatMap((message) => {
                            const historyArray = message.history.value
                            return historyArray.map(
                                (history) => history.__runs?.[variantId]?.__result,
                            )
                        })
                        .filter(Boolean)

                    const isRunning = messageRows.some((inputRow) =>
                        inputRow.history.value.some((history) =>
                            variantId ? history.__runs?.[variantId]?.__isRunning : false,
                        ),
                    )
                    return {resultHashes, isRunning}
                } else {
                    const inputRows = state.generationData.inputs.value

                    const resultHashes = inputRows.map((inputRow) =>
                        variantId ? inputRow?.__runs?.[variantId]?.__result : null,
                    )

                    const isRunning = inputRows.some((inputRow) =>
                        variantId ? inputRow?.__runs?.[variantId]?.__isRunning : false,
                    )

                    return {resultHashes, isRunning}
                }
            },
            [variantId],
        ),
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
    }, [mutate])

    return (
        <section
            className={clsx(
                "h-[48px] flex justify-between items-center gap-4 sticky top-0 z-10",
                classes.container,
            )}
        >
            <Typography className="text-[16px] leading-[18px] font-[600] text-nowrap">
                Generations
            </Typography>

            <div className="flex items-center gap-2">
                <Tooltip title="Clear all">
                    <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                        Clear
                    </Button>
                </Tooltip>

                <LoadTestsetButton label="Load test set" variantId={variantId} />

                <TestsetDrawerButton
                    label="Add all to test set"
                    icon={false}
                    size="small"
                    disabled={isRunning}
                    resultHashes={resultHashes}
                />

                <RunButton
                    isRunAll
                    type="primary"
                    onClick={() => runTests?.()}
                    disabled={isRunning}
                />
            </div>
        </section>
    )
}

export default GenerationHeader
