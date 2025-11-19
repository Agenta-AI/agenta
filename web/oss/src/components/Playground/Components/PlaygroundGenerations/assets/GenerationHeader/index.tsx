import {useCallback, useEffect, useMemo} from "react"

import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {appTypeAtom} from "@/oss/components/Playground/state/atoms/app"
import {
    generationInputRowIdsAtom,
    generationRowIdsAtom,
} from "@/oss/components/Playground/state/atoms/generationProperties"
import {clearAllRunsMutationAtom} from "@/oss/components/Playground/state/atoms/utilityMutations"
import {runAllChatAtom} from "@/oss/state/newPlayground/chat/actions"

import RunButton from "../../../../assets/RunButton"
import {usePlaygroundAtoms} from "../../../../hooks/usePlaygroundAtoms"
import {generationHeaderDataAtomFamily, triggerWebWorkerTestAtom} from "../../../../state/atoms"
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

    const triggerTest = useSetAtom(triggerWebWorkerTestAtom)
    const runAllChat = useSetAtom(runAllChatAtom)
    const appType = useAtomValue(appTypeAtom)
    const completionRowIds = useAtomValue(generationInputRowIdsAtom) as string[]

    const runTests = useCallback(() => {
        if (appType === "chat") runAllChat()
        else {
            // Run for all completion rows: iterate input row ids and trigger tests
            for (const rid of completionRowIds || []) {
                triggerTest({rowId: rid, variantId})
            }
        }
    }, [appType, runAllChat, completionRowIds, triggerTest, variantId])

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if (!isRunning) runTests()
            }
        }
        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [runTests, isRunning])

    return (
        <div
            className={clsx(
                "h-[48px] flex justify-between items-center gap-4 sticky top-0 z-[800] !bg-[white]",
                classes.container,
            )}
        >
            <div className="w-full h-full bg-[white] flex justify-between items-center gap-4">
                <Typography className="text-[16px] leading-[18px] font-[600] text-nowrap">
                    Generations
                </Typography>

                <div className="flex items-center gap-2">
                    <Tooltip title="Clear all">
                        <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                            Clear
                        </Button>
                    </Tooltip>

                    <div id="tour-playground-load-testset">
                        <LoadTestsetButton label="Load testset" variantId={variantId} />
                    </div>

                    <TestsetDrawerButton
                        label="Add all to testset"
                        icon={false}
                        size="small"
                        disabled={isRunning}
                        resultHashes={resultHashes}
                        id="tour-playground-add-testset"
                    />

                    {!isRunning ? (
                        <Tooltip title="Run all (Ctrl+Enter / ⌘+Enter)">
                            <RunButton
                                isRunAll
                                type="primary"
                                onClick={() => runTests()}
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
            </div>
        </div>
    )
}

export default GenerationHeader
