import {memo, useCallback} from "react"

import clsx from "clsx"
import {Button, Tooltip, Typography} from "antd"

import RunButton from "../../../assets/RunButton"
import LoadTestsetButton from "../../Modals/LoadTestsetModal/assets/LoadTestsetButton"
import usePlayground from "../../../hooks/usePlayground"
import {useStyles} from "./styles"

import type {GenerationComparisonHeaderProps} from "./types"
import {clearRuns} from "../../../hooks/usePlayground/assets/generationHelpers"

const GenerationComparisonHeader = ({className}: GenerationComparisonHeaderProps) => {
    const classes = useStyles()
    const {runTests, mutate} = usePlayground()

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
                    <Button size="small" onClick={clearGeneration}>
                        Clear
                    </Button>
                </Tooltip>
                <LoadTestsetButton label="Load test set" />
                <RunButton isRunAll type="primary" onClick={() => runTests?.()} />
            </div>
        </section>
    )
}

export default memo(GenerationComparisonHeader)
