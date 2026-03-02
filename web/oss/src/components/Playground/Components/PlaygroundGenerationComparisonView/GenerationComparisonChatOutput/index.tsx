import {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import TurnMessageAdapter from "@/oss/components/Playground/adapters/TurnMessageAdapter"
// Shared placeholder for empty state
import {usePlaygroundLayout} from "@/oss/components/Playground/hooks/usePlaygroundLayout"
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {
    generationInputRowIdsAtom,
    generationRowIdsAtom,
} from "@/oss/components/Playground/state/atoms/generationProperties"
import {chatTurnsByIdAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {
    addChatTurnAtom,
    cancelChatTurnAtom,
    runChatTurnAtom,
} from "@/oss/state/newPlayground/chat/actions"

import LastTurnFooterControls from "../../ChatCommon/LastTurnFooterControls"
import GenerationChatTurnNormalized from "../../PlaygroundGenerations/assets/GenerationChatTurnNormalized"
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"

import {GenerationComparisonChatOutputCellProps, GenerationComparisonChatOutputProps} from "./types"

// No local schema plumbing; PromptMessageConfig derives structure internally

const GenerationComparisonChatOutputCell = ({
    variantId,
    turnId,
    variantIndex,
    isFirstRow,
}: GenerationComparisonChatOutputCellProps) => {
    const inputRowIds = useAtomValue(generationInputRowIdsAtom)
    // Use the same list the renderer uses to decide "last" row
    const allRowIds = useAtomValue(generationRowIdsAtom) as string[]
    const isLastTurn = (allRowIds || [])[Math.max(0, (allRowIds || []).length - 1)] === turnId

    const displayedVariantIds = useAtomValue(displayedVariantsAtom)
    const addTurn = useSetAtom(addChatTurnAtom)
    const runTurn = useSetAtom(runChatTurnAtom)
    const cancelTurn = useSetAtom(cancelChatTurnAtom)
    const turnsById = useAtomValue(chatTurnsByIdAtom) as Record<string, any>
    const userMessageId = useMemo(
        () => (turnsById?.[turnId] as any)?.userMessage?.__id as string | undefined,
        [turnsById, turnId],
    )
    const runStatusMap = useAtomValue(runStatusByRowRevisionAtom) as Record<string, any>
    const resultHashes = useMemo(() => {
        try {
            const hashes = (displayedVariantIds || []).map((revId: string) => {
                const entry = runStatusMap?.[`${turnId}:${revId}`]
                return entry?.resultHash as string | undefined
            })
            return hashes.filter((h): h is string => typeof h === "string" && h.length > 0)
        } catch {
            return [] as string[]
        }
    }, [runStatusMap, displayedVariantIds, turnId])

    return (
        <>
            <div
                className={clsx([
                    "shrink-0 flex flex-col self-stretch sticky left-0 z-[3] bg-white border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-r": variantIndex === 0},
                ])}
            >
                {variantIndex === 0 && (
                    <div className="!w-[400px] shrink-0 sticky top-9 z-[2]">
                        <div>
                            {isFirstRow &&
                                inputRowIds.map((inputRowId) => {
                                    return (
                                        <GenerationCompletionRow
                                            key={inputRowId}
                                            rowId={inputRowId}
                                            inputOnly={true}
                                        />
                                    )
                                })}
                        </div>

                        <div className="flex flex-col gap-2">
                            <TurnMessageAdapter
                                variantId={variantId}
                                rowId={turnId as string}
                                kind="user"
                                className="w-full"
                                handleRerun={() => runTurn({turnId, messageId: userMessageId})}
                                resultHashes={resultHashes}
                                messageOptionProps={{
                                    hideAddToTestset: true,
                                    allowFileUpload: true,
                                }}
                                messageProps={{
                                    className:
                                        "!p-0 [&_.agenta-editor-wrapper]:!p-3 !mt-0 [&:nth-child(1)]:!mt-0 mt-2",
                                    editorClassName: "!p-3",
                                    headerClassName:
                                        "min-h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                                    footerClassName: "px-2",
                                    editorType: "borderless",
                                }}
                            />
                            {isLastTurn ? (
                                <LastTurnFooterControls
                                    logicalId={turnId}
                                    onRun={() => runTurn({turnId: turnId})}
                                    onCancelAll={() => cancelTurn({turnId: turnId})}
                                    onAddMessage={() => addTurn()}
                                    className="p-3"
                                />
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            <div
                className={clsx([
                    "!min-w-[400px] flex-1",
                    "shrink-0",
                    "flex flex-col self-stretch",
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="!w-full shrink-0 sticky top-9 z-[2]">
                    <GenerationChatTurnNormalized
                        turnId={turnId}
                        variantId={variantId}
                        withControls={false}
                        hideUserMessage
                        messageProps={{
                            className:
                                "!p-0 [&_.agenta-editor-wrapper]:!p-3 !mt-0 [&:nth-child(1)]:!mt-0 mt-2",
                            editorClassName: "!p-3",
                            headerClassName:
                                "min-h-[48px] border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                            footerClassName: "px-3 !m-0",
                            editorType: "borderless",
                        }}
                    />
                </div>
            </div>
        </>
    )
}

const GenerationComparisonChatOutput = ({
    turnId,
    isFirstRow,
}: GenerationComparisonChatOutputProps) => {
    const {displayedVariants} = usePlaygroundLayout()

    return (
        <div className="flex">
            {(displayedVariants || []).map((variantId, variantIndex) => {
                return (
                    <GenerationComparisonChatOutputCell
                        key={`${turnId}-${variantId}`}
                        variantId={variantId}
                        turnId={turnId}
                        variantIndex={variantIndex}
                        isFirstRow={isFirstRow}
                    />
                )
            })}
        </div>
    )
}

export default GenerationComparisonChatOutput
