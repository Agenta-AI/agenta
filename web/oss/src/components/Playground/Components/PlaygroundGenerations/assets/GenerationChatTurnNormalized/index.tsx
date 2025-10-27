import {useCallback, useMemo} from "react"

// antd imports not needed here
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
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
import {assistantMessageAtomFamily, chatTurnAtomFamily} from "@/oss/state/generation/selectors"
import {
    addChatTurnAtom,
    runChatTurnAtom,
    cancelChatTurnAtom,
} from "@/oss/state/newPlayground/chat/actions"

interface Props {
    turnId: string
    variantId?: string
    withControls?: boolean
    className?: string
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

    const displayAssistantValue = useAssistantDisplayValue(assistantMsg, result)

    const turnState = useAtomValue(useMemo(() => chatTurnAtomFamily(sessionRowId), [sessionRowId]))

    const toolMessages = useMemo(() => {
        if (!variantId) return [] as any[]
        const responses = turnState?.toolResponsesByRevision?.[variantId]
        return Array.isArray(responses) ? responses : []
    }, [turnState, variantId])

    const hasAssistantContent = useHasAssistantContent(
        assistantMsg as any,
        displayAssistantValue,
        toolMessages.length > 0,
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
                    <TurnMessageAdapter
                        variantId={variantId as string}
                        rowId={sessionRowId}
                        kind="assistant"
                        className="w-full"
                        headerClassName="border-0 border-b border-solid border-[rgba(5,23,41,0.06)]"
                        footer={result ? <GenerationResultUtils result={result as any} /> : null}
                        messageProps={messageProps}
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
