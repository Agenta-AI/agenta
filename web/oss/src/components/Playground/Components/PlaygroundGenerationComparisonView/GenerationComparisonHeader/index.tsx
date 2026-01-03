import {memo, useCallback, useEffect, useMemo} from "react"

import {ArrowsInLineVertical, ArrowsOutLineVertical} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"

import {inputRowIdsWithPropertiesCompatAtom} from "@/oss/state/generation/compat"
import {runAllChatAtom} from "@/oss/state/newPlayground/chat/actions"
import {triggerWebWorkerTestAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import TooltipButton from "../../../assets/EnhancedButton"
import RunButton from "../../../assets/RunButton"
import {
    appChatModeAtom,
    generationHeaderDataAtomFamily,
    displayedVariantsAtom,
    cancelTestsMutationAtom,
    canRunAllChatComparisonAtom,
} from "../../../state/atoms"
import {clearAllRunsMutationAtom} from "../../../state/atoms/utilityMutations"
import TestsetDrawerButton from "../../Drawers/TestsetDrawer"
import LoadTestsetButton from "../../Modals/LoadTestsetModal/assets/LoadTestsetButton"
import {allGenerationsCollapsedAtom} from "../../PlaygroundGenerations/assets/GenerationHeader"

import {useStyles} from "./styles"
import type {GenerationComparisonHeaderProps} from "./types"

const GenerationComparisonHeader = ({className}: GenerationComparisonHeaderProps) => {
    const classes = useStyles()

    // Use atom-based state management
    const displayedVariantIds = useAtomValue(displayedVariantsAtom) || []
    const [inputRowIds] = useAtom(inputRowIdsWithPropertiesCompatAtom)
    const clearAllRuns = useSetAtom(clearAllRunsMutationAtom)
    const isChatVariant = useAtomValue(appChatModeAtom) ?? false
    const triggerTest = useSetAtom(triggerWebWorkerTestAtom)
    const runAllChat = useSetAtom(runAllChatAtom)
    const cancelTests = useSetAtom(cancelTestsMutationAtom)
    const canRunAllChat = useAtomValue(canRunAllChatComparisonAtom)
    const [isAllCollapsed, setIsAllCollapsed] = useAtom(allGenerationsCollapsedAtom)

    const headerDataAtom = useMemo(
        () =>
            atom((get) => {
                if (isChatVariant) return {resultHashes: [], isRunning: false}
                const vids = (get(displayedVariantsAtom) || []) as string[]
                const status = get(
                    // Reuse generationHeaderData per variant and fold
                    atom((g) => vids.map((id) => g(generationHeaderDataAtomFamily(id)))),
                ) as {resultHashes: string[]; isRunning: boolean}[]
                const resultHashes = status.flatMap((d) => d.resultHashes || [])
                const isRunning = status.some((d) => d.isRunning)
                return {resultHashes: resultHashes.filter(Boolean), isRunning}
            }),
        [isChatVariant],
    )
    const {resultHashes, isRunning} = useAtomValue(headerDataAtom)

    // Create a runTests function that runs all available input rows
    const runTests = useCallback(() => {
        if (isChatVariant) {
            if (canRunAllChat) runAllChat()
            return
        }
        ;(inputRowIds as string[]).forEach((rid) => {
            ;(displayedVariantIds as string[]).forEach((vid) => {
                triggerTest({rowId: rid, variantId: vid} as any)
            })
        })
    }, [triggerTest, isChatVariant, inputRowIds, displayedVariantIds, runAllChat, canRunAllChat])

    const clearGeneration = useCallback(() => {
        clearAllRuns()
    }, [clearAllRuns])

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if (!isRunning && (!isChatVariant || canRunAllChat)) runTests?.()
            }
        }
        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [runTests, isRunning])

    return (
        <section
            className={clsx(
                "flex items-center justify-between gap-2 px-4 py-2 h-[40px] flex-shrink-0",
                classes.header,
                className,
            )}
        >
            {isChatVariant ? (
                <Typography className={classes.heading}>Generations</Typography>
            ) : (
                <TooltipButton
                    icon={
                        isAllCollapsed ? (
                            <ArrowsOutLineVertical size={16} />
                        ) : (
                            <ArrowsInLineVertical size={16} />
                        )
                    }
                    type="text"
                    onClick={() => setIsAllCollapsed(!isAllCollapsed)}
                    tooltipProps={{
                        title: isAllCollapsed ? "Expand all" : "Collapse all",
                    }}
                    className={classes.heading}
                />
            )}

            <div className="flex items-center gap-2">
                <Tooltip title="Clear all">
                    <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                        Clear
                    </Button>
                </Tooltip>
                <TestsetDrawerButton
                    label="Add all to testset"
                    icon={false}
                    size="small"
                    resultHashes={resultHashes}
                    key={resultHashes?.join("-") || "no-results"}
                />
                <LoadTestsetButton label="Load testset" />

                {!isRunning ? (
                    <Tooltip title="Run all (Ctrl+Enter / ⌘+Enter)">
                        <RunButton
                            isRunAll
                            type="primary"
                            disabled={isRunning || (isChatVariant && !canRunAllChat)}
                            onClick={() => runTests?.()}
                        />
                    </Tooltip>
                ) : (
                    <RunButton isCancel onClick={() => cancelTests({})} className="flex" />
                )}
            </div>
        </section>
    )
}

export default memo(GenerationComparisonHeader)
