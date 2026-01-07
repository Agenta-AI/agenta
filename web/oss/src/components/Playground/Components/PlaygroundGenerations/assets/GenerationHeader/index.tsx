import {useCallback, useEffect, useMemo} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, InputNumber, Popover, Slider, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {appTypeAtom} from "@/oss/components/Playground/state/atoms/app"
import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {clearAllRunsMutationAtom} from "@/oss/components/Playground/state/atoms/utilityMutations"
import {runAllChatAtom} from "@/oss/state/newPlayground/chat/actions"
import {repetitionCountAtom} from "@/oss/state/newPlayground/generation/options"

import RunButton from "../../../../assets/RunButton"
import {usePlaygroundAtoms} from "../../../../hooks/usePlaygroundAtoms"
import {generationHeaderDataAtomFamily, triggerWebWorkerTestAtom} from "../../../../state/atoms"

import {useStyles} from "./styles"
import TestSetMenu from "./TestSetMenu"
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
    const [repetitionCount, setRepetitionCount] = useAtom(repetitionCountAtom)

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
                "h-[48px] flex justify-between items-center gap-4 sticky top-0 z-[1000] !bg-[white]",
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

                    <TestSetMenu
                        variantId={variantId}
                        resultHashes={resultHashes}
                        isRunning={isRunning}
                    />

                    {!isRunning ? (
                        <div className="flex">
                            <Tooltip title="Run all (Ctrl+Enter / ⌘+Enter)">
                                <RunButton
                                    isRunAll
                                    type="primary"
                                    onClick={() => runTests()}
                                    disabled={isRunning}
                                    style={{borderRadius: "6px 0 0 6px"}}
                                />
                            </Tooltip>
                            <RunOptionsPopover isRunning={isRunning} variantId={variantId} />
                        </div>
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

const RunOptionsPopover = ({isRunning, variantId}: {isRunning: boolean; variantId: string}) => {
    const [repetitionCount, setRepetitionCount] = useAtom(repetitionCountAtom)

    const content = (
        <div className="flex flex-col gap-4 w-[300px]">
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                    <Typography.Text strong>Repetitions</Typography.Text>
                    <InputNumber
                        min={1}
                        max={10}
                        value={repetitionCount}
                        onChange={(val) => setRepetitionCount(val || 1)}
                        size="small"
                        className="w-[60px]"
                        disabled={isRunning}
                    />
                </div>
                <Typography.Text type="secondary" className="text-xs">
                    Run the same prompt multiple times to reduce variability in results.{" "}
                    <a
                        href="https://docs.agenta.ai/evaluation/repetition"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                    >
                        Learn more
                    </a>
                </Typography.Text>
                <Slider
                    min={1}
                    max={10}
                    value={repetitionCount}
                    onChange={(val) => setRepetitionCount(val)}
                    disabled={isRunning}
                />
            </div>
        </div>
    )

    return (
        <Popover
            content={content}
            trigger="click"
            placement="bottomRight"
            arrow={false}
            overlayInnerStyle={{padding: "16px"}}
        >
            <Button
                type="primary"
                icon={<CaretDown size={14} />}
                size="small"
                disabled={isRunning}
                style={{
                    borderRadius: "0 6px 6px 0",
                    borderLeft: "1px solid rgba(255, 255, 255, 0.4)",
                    width: "32px",
                    padding: 0,
                }}
            />
        </Popover>
    )
}
