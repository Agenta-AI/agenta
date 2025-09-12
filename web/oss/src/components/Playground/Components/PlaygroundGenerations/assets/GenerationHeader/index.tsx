import {useEffect, useMemo} from "react"

import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import RunButton from "../../../../assets/RunButton"
import {usePlaygroundAtoms} from "../../../../hooks/usePlaygroundAtoms"
import {generationHeaderDataAtomFamily, clearAllRunsMutationAtom} from "../../../../state/atoms"
import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import LoadTestsetButton from "../../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

import {useStyles} from "./styles"
import type {GenerationHeaderProps} from "./types"

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
    const classes = useStyles()

    // ATOM-LEVEL OPTIMIZATION: Use focused atom for generation header data
    // Memoize the atom to prevent infinite re-renders
    const generationHeaderAtom = useMemo(
        () => generationHeaderDataAtomFamily(variantId),
        [variantId],
    )
    const {resultHashes, isRunning} = useAtomValue(generationHeaderAtom)

    // Use optimized playground atoms for mutations
    const playgroundAtoms = usePlaygroundAtoms()
    const clearGeneration = useSetAtom(clearAllRunsMutationAtom)

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if (!isRunning) playgroundAtoms.runTests?.(undefined)
            }
        }
        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [playgroundAtoms.runTests, isRunning])

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

                {!isRunning ? (
                    <Tooltip title="Run all (Ctrl+Enter / ⌘+Enter)">
                        <RunButton
                            isRunAll
                            type="primary"
                            onClick={() => playgroundAtoms.runTests?.()}
                            disabled={isRunning}
                        />
                    </Tooltip>
                ) : (
                    <RunButton
                        isCancel
                        onClick={() => playgroundAtoms.cancelRunTests?.()}
                        className="flex"
                    />
                )}
            </div>
        </section>
    )
}

export default GenerationHeader
