import {useCallback, useEffect, useMemo} from "react"

import {ArrowsOutLineHorizontal} from "@phosphor-icons/react"
import {Typography} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import TurnMessageAdapter from "@/oss/components/Playground/adapters/TurnMessageAdapter"
import TypingIndicator from "@/oss/components/Playground/assets/TypingIndicator"
import ControlsBar from "@/oss/components/Playground/Components/ChatCommon/ControlsBar"
import {ClickRunPlaceholder} from "@/oss/components/Playground/Components/PlaygroundGenerations/assets/ResultPlaceholder"
import {useAssistantDisplayValue} from "@/oss/components/Playground/hooks/chat/useAssistant"
import useEffectiveRevisionId from "@/oss/components/Playground/hooks/chat/useEffectiveRevisionId"
import useHasAssistantContent from "@/oss/components/Playground/hooks/chat/useHasAssistantContent"
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {resolvedGenerationResultAtomFamily} from "@/oss/components/Playground/state/atoms/generationProperties"
import {messageSchemaMetadataAtom} from "@/oss/state/generation/entities"
import {assistantMessageAtomFamily, chatTurnAtomFamily} from "@/oss/state/generation/selectors"
import {
    addChatTurnAtom,
    cancelChatTurnAtom,
    runChatTurnAtom,
} from "@/oss/state/newPlayground/chat/actions"
import {repetitionIndexAtomFamily} from "@/oss/state/newPlayground/generation/uiState"
import {buildAssistantMessage} from "@/oss/state/newPlayground/helpers/messageFactory"
import {openPlaygroundFocusDrawerAtom} from "@/oss/state/playgroundFocusDrawerAtom"

import RepetitionNavigation from "../RepetitionNavigation"
import EnhancedButton from "@/oss/components/EnhancedUIs/Button"

interface Props {
    turnId: string
    variantId?: string
    withControls?: boolean
    className?: string
    hideUserMessage?: boolean
    messageProps?: any
}

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

const GenerationChatTurnNormalized = ({
    turnId,
    variantId,
    withControls,
    className,
    hideUserMessage = false,
    messageProps,
}: Props) => {
    const displayedVariantIds = useAtomValue(displayedVariantsAtom)
    const setAddTurn = useSetAtom(addChatTurnAtom)
    const runTurn = useSetAtom(runChatTurnAtom)
    const cancelTurn = useSetAtom(cancelChatTurnAtom)
    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)

    const effectiveRevisionId = useEffectiveRevisionId(variantId, displayedVariantIds as any)
    const resolvedTurnId = turnId

    // Run status and result for this turn + revision via normalized atoms
    const genResultAtom = useMemo(
        () =>
            resolvedGenerationResultAtomFamily({
                variantId: variantId as string,
                rowId: (resolvedTurnId || turnId) as string,
            }),
        [variantId, resolvedTurnId, turnId],
    )
    const {isRunning, result: inlineResult} = useAtomValue(genResultAtom) as any
    const result = inlineResult

    const [repetitionIndex, setRepetitionIndex] = useAtom(
        useMemo(
            () => repetitionIndexAtomFamily(`${resolvedTurnId || turnId}:${variantId}`),
            [resolvedTurnId, turnId, variantId],
        ),
    )

    useEffect(() => {
        setRepetitionIndex(0)
    }, [result, setRepetitionIndex])

    const totalRepetitions = Array.isArray(result) ? result.length : result ? 1 : 0
    const safeIndex =
        repetitionIndex >= totalRepetitions ? Math.max(0, totalRepetitions - 1) : repetitionIndex

    const currentResult = useMemo(() => {
        if (Array.isArray(result) && totalRepetitions > 0) {
            return result[safeIndex]
        }
        return result
    }, [result, safeIndex, totalRepetitions])

    const messageSchema = useAtomValue(messageSchemaMetadataAtom)

    const messageOverride = useMemo(() => {
        if (Array.isArray(result) && result.length > 0) {
            return buildAssistantMessage(messageSchema, currentResult)
        }
        return undefined
    }, [result, currentResult, messageSchema])

    const onRun = useCallback(() => {
        runTurn({turnId, variantId: variantId as string | undefined})
    }, [runTurn, turnId, variantId, effectiveRevisionId, resolvedTurnId])

    const onCancel = useCallback(() => {
        if (!resolvedTurnId) return
        cancelTurn({
            turnId: resolvedTurnId || turnId,
            variantId: effectiveRevisionId as string | undefined,
        })
    }, [cancelTurn, resolvedTurnId, turnId, effectiveRevisionId])

    const sessionRowId = useMemo(
        () =>
            (resolvedTurnId ||
                (variantId && turnId ? `turn-${variantId}-${turnId}` : turnId)) as string,
        [resolvedTurnId, variantId, turnId],
    )

    const assistantMsg = useAtomValue(
        useMemo(
            () =>
                assistantMessageAtomFamily({
                    turnId: sessionRowId,
                    revisionId: variantId as string,
                }),
            [sessionRowId, variantId],
        ),
    ) as any

    const displayAssistantValue = useAssistantDisplayValue(
        messageOverride || assistantMsg,
        currentResult,
    )

    const turnState = useAtomValue(useMemo(() => chatTurnAtomFamily(sessionRowId), [sessionRowId]))

    const toolMessages = useMemo(() => {
        if (!variantId) return [] as any[]
        const responses = turnState?.toolResponsesByRevision?.[variantId]
        return Array.isArray(responses) ? responses : []
    }, [turnState, variantId])

    const hasAssistantContent = useHasAssistantContent(
        (messageOverride || assistantMsg) as any,
        displayAssistantValue,
        toolMessages.length > 0,
    )

    const repetitionProps = useMemo(
        () =>
            totalRepetitions > 1
                ? {
                      current: safeIndex + 1,
                      total: totalRepetitions,
                      onNext: () =>
                          setRepetitionIndex((prev) => Math.min(totalRepetitions - 1, prev + 1)),
                      onPrev: () => setRepetitionIndex((prev) => Math.max(0, prev - 1)),
                  }
                : undefined,
        [totalRepetitions, safeIndex, setRepetitionIndex],
    )

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {!hideUserMessage ? (
                <TurnMessageAdapter
                    variantId={variantId as string}
                    rowId={turnId}
                    kind="user"
                    className="w-full"
                    messageOptionProps={{
                        allowFileUpload: true,
                    }}
                    messageProps={messageProps}
                />
            ) : null}
            {withControls ? (
                <ControlsBar
                    isRunning={Boolean(isRunning)}
                    onRun={onRun}
                    onCancel={onCancel}
                    onAddMessage={() => setAddTurn()}
                />
            ) : null}
            {isRunning && !hasAssistantContent ? (
                // While running, suppress any previous assistant message/error to avoid stale content
                <TypingIndicator />
            ) : hasAssistantContent ? (
                <>
                    <div className="flex gap-2 justify-between items-center">
                        <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                            Total repetitions: {repetitionProps?.total}
                        </Typography.Text>

                        <div className="flex gap-2 items-center">
                            <EnhancedButton
                                icon={<ArrowsOutLineHorizontal size={12} />}
                                size="small"
                                className="!w-5 !h-5"
                                onClick={() => openFocusDrawer({rowId: sessionRowId, variantId})}
                                tooltipProps={{title: "View all repetitions"}}
                            />
                            <RepetitionNavigation {...repetitionProps} />
                        </div>
                    </div>
                    <TurnMessageAdapter
                        key={`${sessionRowId}-assistant-${repetitionIndex}`}
                        variantId={variantId as string}
                        rowId={sessionRowId}
                        kind="assistant"
                        className="w-full"
                        headerClassName="border-0 border-b border-solid border-[rgba(5,23,41,0.06)]"
                        footer={
                            <div className="w-full flex justify-between items-center mt-2 gap-2">
                                {currentResult ? (
                                    <GenerationResultUtils result={currentResult as any} />
                                ) : (
                                    <div />
                                )}
                            </div>
                        }
                        messageProps={messageProps}
                        messageOverride={messageOverride}
                    />
                    {variantId
                        ? toolMessages.map((_, index) => (
                              <TurnMessageAdapter
                                  key={`${sessionRowId}-tool-${index}`}
                                  variantId={variantId}
                                  rowId={sessionRowId}
                                  kind="tool"
                                  toolIndex={index}
                                  className="w-full"
                                  messageProps={messageProps}
                              />
                          ))
                        : null}
                </>
            ) : (
                <ClickRunPlaceholder />
            )}
        </div>
    )
}

export default GenerationChatTurnNormalized
