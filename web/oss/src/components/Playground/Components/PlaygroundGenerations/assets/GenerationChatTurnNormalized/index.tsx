import {useCallback, useMemo} from "react"

import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import TurnMessageAdapter from "@/oss/components/Playground/adapters/TurnMessageAdapter"
import TypingIndicator from "@/oss/components/Playground/assets/TypingIndicator"
import ControlsBar from "@/oss/components/Playground/Components/ChatCommon/ControlsBar"
import GatewayToolExecuteButton from "@/oss/components/Playground/Components/PlaygroundGenerations/assets/GatewayToolExecuteButton"
import {ClickRunPlaceholder} from "@/oss/components/Playground/Components/PlaygroundGenerations/assets/ResultPlaceholder"
import {createToolCallPayloads} from "@/oss/components/Playground/Components/ToolCallView"
import {useAssistantDisplayValue} from "@/oss/components/Playground/hooks/chat/useAssistant"
import useEffectiveRevisionId from "@/oss/components/Playground/hooks/chat/useEffectiveRevisionId"
import useHasAssistantContent from "@/oss/components/Playground/hooks/chat/useHasAssistantContent"
import {useRepetitionResult} from "@/oss/components/Playground/hooks/useRepetitionResult"
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {resolvedGenerationResultAtomFamily} from "@/oss/components/Playground/state/atoms/generationProperties"
import {chatTurnsByIdFamilyAtom, messageSchemaMetadataAtom} from "@/oss/state/generation/entities"
import {chatTurnAtomFamily} from "@/oss/state/generation/selectors"
import {
    addChatTurnAtom,
    cancelChatTurnAtom,
    runChatTurnAtom,
} from "@/oss/state/newPlayground/chat/actions"
import {buildAssistantMessage} from "@/oss/state/newPlayground/helpers/messageFactory"

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

    const setTurn = useSetAtom(chatTurnsByIdFamilyAtom(turnId))

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

    const {currentResult, repetitionIndex, repetitionProps} = useRepetitionResult({
        rowId: resolvedTurnId || turnId,
        variantId: variantId as string,
        result,
    })

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

    const sessionRowId = turnId
    const turn = useAtomValue(chatTurnsByIdFamilyAtom(sessionRowId)) as any

    const assistantMsg = useMemo(() => {
        return turn?.assistantMessageByRevision?.[variantId as string] ?? null
    }, [turn, variantId])

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

    // Extract tool call payloads from the assistant message for gateway tool execution
    const assistantToolPayloads = useMemo(
        () => createToolCallPayloads((messageOverride || assistantMsg)?.toolCalls?.value),
        [messageOverride, assistantMsg],
    )

    // Update a tool response message content with the execution result
    const handleUpdateToolResponse = useCallback(
        (callId: string | undefined, resultStr: string) => {
            setTurn((draft: any) => {
                const toolResponses = draft?.toolResponsesByRevision?.[variantId as string]
                if (!Array.isArray(toolResponses)) return
                const matchIndex = callId
                    ? toolResponses.findIndex(
                          (m: any) =>
                              m?.toolCallId?.value === callId || m?.tool_call_id?.value === callId,
                      )
                    : 0
                if (matchIndex < 0) return
                const toolMsg = toolResponses[matchIndex]
                if (!toolMsg) return
                // If the schema didn't include a content field, create it directly
                if (!toolMsg.content) {
                    toolMsg.content = {value: resultStr}
                    return
                }
                const cv = toolMsg.content.value
                if (Array.isArray(cv)) {
                    const idx = cv.findIndex((p: any) => (p?.type?.value ?? p?.type) === "text")
                    if (idx >= 0) {
                        cv[idx].text.value = resultStr
                    } else {
                        cv.push({type: {value: "text"}, text: {value: resultStr}})
                    }
                } else {
                    toolMsg.content.value = resultStr
                }
            })
        },
        [setTurn, variantId],
    )

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {!hideUserMessage ? (
                <TurnMessageAdapter
                    variantId={variantId as string}
                    rowId={turnId}
                    kind="user"
                    className="w-full"
                    hideExpandResults
                    messageOptionProps={{
                        hideAddToTestset: true,
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
                    <TurnMessageAdapter
                        key={`${sessionRowId}-assistant-${repetitionIndex}`}
                        variantId={variantId as string}
                        rowId={sessionRowId}
                        kind="assistant"
                        className="w-full"
                        headerClassName="border-0 border-b border-solid border-[rgba(5,23,41,0.06)]"
                        footer={
                            <div className="w-full flex flex-col gap-2 mt-2">
                                <div className="flex justify-between items-center gap-2">
                                    {currentResult ? (
                                        <GenerationResultUtils result={currentResult as any} />
                                    ) : (
                                        <div />
                                    )}
                                </div>
                                <GatewayToolExecuteButton
                                    toolPayloads={assistantToolPayloads}
                                    onUpdateToolResponse={handleUpdateToolResponse}
                                    onExecuteAndSendToChat={onRun}
                                />
                            </div>
                        }
                        messageProps={messageProps}
                        messageOverride={messageOverride}
                        repetitionProps={repetitionProps}
                        hideRerun
                        messageOptionProps={{
                            allowFileUpload: false,
                        }}
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
