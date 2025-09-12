import {useCallback, useEffect, useMemo} from "react"

// antd imports not needed here
import clsx from "clsx"
import {produce} from "immer"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import TypingIndicator from "@/oss/components/Playground/assets/TypingIndicator"
import AssistantMessageBlock from "@/oss/components/Playground/Components/ChatCommon/AssistantMessageBlock"
import ControlsBar from "@/oss/components/Playground/Components/ChatCommon/ControlsBar"
import UserMessageBlock from "@/oss/components/Playground/Components/ChatCommon/UserMessageBlock"
import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {
    useAssistantDisplayValue,
    useToolCallsView,
} from "@/oss/components/Playground/hooks/chat/useAssistant"
import {useAssistantMessage} from "@/oss/components/Playground/hooks/chat/useAssistantMessage"
import useCancelControls from "@/oss/components/Playground/hooks/chat/useCancelControls"
import useDeleteLogicalRow from "@/oss/components/Playground/hooks/chat/useDeleteLogicalRow"
import useEffectiveRevisionId from "@/oss/components/Playground/hooks/chat/useEffectiveRevisionId"
import useHasAssistantContent from "@/oss/components/Playground/hooks/chat/useHasAssistantContent"
import useMessageMetadata from "@/oss/components/Playground/hooks/chat/useMessageMetadata"
import {
    useUserMessageFromMetadata,
    useAssistantMessageFromMetadata,
} from "@/oss/components/Playground/hooks/chat/useMessagesFromMetadata"
import useResolvedTurnId from "@/oss/components/Playground/hooks/chat/useResolvedTurnId"
import useRunControls from "@/oss/components/Playground/hooks/chat/useRunControls"
import useRunResult from "@/oss/components/Playground/hooks/chat/useRunResult"
import {
    useUserMessageValue,
    useHistoryUserContent,
    useResolvedUserContent,
} from "@/oss/components/Playground/hooks/chat/useUserContent"
// message creation handled via useMessagesFromMetadata hooks
import {usePlaygroundAtoms} from "@/oss/components/Playground/hooks/usePlaygroundAtoms"
// SharedEditor is not used directly; PromptMessageConfig handles rendering
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {addEmptyChatTurnMutationAtom} from "@/oss/components/Playground/state/atoms/generationMutations"
import {pruneLogicalTurnIndexForDisplayedVariantsMutationAtom} from "@/oss/components/Playground/state/atoms/generationMutations"
import {pruneTurnsAfterLogicalIdMutationAtom} from "@/oss/components/Playground/state/atoms/generationMutations"
import {regenerateSingleModeChatFromActiveRevisionAtom} from "@/oss/components/Playground/state/atoms/generationMutations"
// metadata/result helpers handled via shared hooks
import {setUserMessageContentMutationAtom} from "@/oss/components/Playground/state/atoms/mutations/chat/setUserMessageContent"
import {
    chatTurnsByIdAtom,
    runStatusByRowRevisionAtom,
    type PropertyNode,
} from "@/oss/state/generation/entities"
import {chatSessionsByIdAtom} from "@/oss/state/generation/entities"
import {logicalTurnIndexAtom} from "@/oss/state/generation/entities"
import {chatTurnAtomFamily} from "@/oss/state/generation/selectors"

// import {UserMessageBlock} from "../../../../ChatCommon/UserMessageBlock"
// ChatCommon components imported above

interface Props {
    turnId: string
    variantId?: string
    withControls?: boolean
    className?: string
}

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

const GenerationChatTurnNormalized = ({turnId, variantId, withControls, className}: Props) => {
    const displayedVariantIds = useAtomValue(displayedVariantsAtom)
    const addEmptyTurn = useSetAtom(addEmptyChatTurnMutationAtom)
    const pruneLogicalIndex = useSetAtom(pruneLogicalTurnIndexForDisplayedVariantsMutationAtom)
    const pruneAfterLogical = useSetAtom(pruneTurnsAfterLogicalIdMutationAtom)
    const regenerateSingle = useSetAtom(regenerateSingleModeChatFromActiveRevisionAtom)
    const {_rerunChatOutput: _unusedRerun} = usePlaygroundAtoms({}) as any
    const turnsById = useAtomValue(chatTurnsByIdAtom)
    const sessionsById = useAtomValue(chatSessionsByIdAtom)

    const logicalIndex = useAtomValue(useMemo(() => logicalTurnIndexAtom, [])) as any

    // On mount (single view), prune stale logical mappings and regenerate from active revision
    useEffect(() => {
        pruneLogicalIndex()
        regenerateSingle()
    }, [pruneLogicalIndex, regenerateSingle])

    // Assistant output for this turn + revision
    const assistantMsg =
        (useAssistantMessage({turnId, revisionId: variantId}) as PropertyNode) || (null as any)

    // Resolve active revision id and target row id via shared hooks
    const effectiveRevisionId = useEffectiveRevisionId(variantId, displayedVariantIds as any)

    // Resolve correct session turn id for active revision (handles baseline turn ids after mode switches)
    const resolvedTurnId = useResolvedTurnId({
        turnId,
        effectiveRevisionId,
        logicalIndex: logicalIndex as any,
        sessionsById: sessionsById as any,
        turnsById: turnsById as any,
        turnIdIsLogical: false,
    })

    // Run status and result for this turn + revision via shared hook
    const {isRunning, resultHash, result} = useRunResult({
        rowId: resolvedTurnId,
        variantId: variantId as string,
    })

    // Read user message and derive fallback from history via shared hooks
    const directUserContent = useUserMessageValue(resolvedTurnId)
    const historyText = useHistoryUserContent(effectiveRevisionId, turnId)
    const userContent = useResolvedUserContent(directUserContent, historyText)

    const {runForRevisions} = useRunControls()
    const {onCancelAll} = useCancelControls()

    const onRun = useCallback(() => {
        const t = (turnsById as any)?.[turnId]
        const logicalId = t?.logicalTurnId || turnId
        const sessionId: string | undefined = t?.sessionId
        const baselineRev = sessionId?.startsWith("session-")
            ? sessionId.slice("session-".length)
            : undefined
        const logicalMap = logicalId ? (logicalIndex as any)?.[logicalId] || {} : {}
        const revs: string[] = variantId
            ? [variantId]
            : Array.isArray(displayedVariantIds)
              ? (displayedVariantIds as string[])
              : []

        runForRevisions(
            logicalId,
            revs,
            logicalMap,
            baselineRev,
            resolvedTurnId,
            turnId,
            turnsById as any,
            sessionsById as any,
        )
    }, [
        turnsById,
        sessionsById,
        turnId,
        variantId,
        displayedVariantIds,
        logicalIndex,
        resolvedTurnId,
        runForRevisions,
    ])

    const onCancel = useCallback(() => {
        onCancelAll()
    }, [onCancelAll])

    // Build lightweight message schema via shared hook
    const messageMetadata = useMessageMetadata(variantId)

    // Read normalized turn to align property ids
    const normalizedTurn = useAtomValue(useMemo(() => chatTurnAtomFamily(turnId), [turnId])) as any

    const userMessage = useUserMessageFromMetadata(
        messageMetadata,
        normalizedTurn?.userMessage,
        userContent || "",
        {turnId},
    )

    const displayAssistantValue = useAssistantDisplayValue(assistantMsg, result)

    // Detect and prepare a code-style JSON rendering for tool/function-only responses
    const toolCallsView = useToolCallsView(result)

    const assistantMessage = useAssistantMessageFromMetadata(
        messageMetadata,
        assistantMsg as any,
        displayAssistantValue || "",
        {turnIdOrRowId: turnId},
    ) as any

    const hasAssistantContent = useHasAssistantContent(assistantMsg as any, displayAssistantValue)

    // no-op

    // Shared delete handler via unified hook
    const {useDeleteRowFromResolvedTurn} = useDeleteLogicalRow()
    const onDeleteRow = useDeleteRowFromResolvedTurn(resolvedTurnId)

    // Assistant-only delete for single view: clear assistant for current revision and prune trailing rows
    const setChatTurns = useSetAtom(chatTurnsByIdAtom)
    const setRunStatusMap = useSetAtom(runStatusByRowRevisionAtom)
    const onDeleteAssistant = useCallback(() => {
        // Clear assistant at this revision for the resolved session turn
        setChatTurns((prev) =>
            produce(prev as any, (draft: any) => {
                const t = draft?.[resolvedTurnId]
                if (!t) return
                if (!t.assistantMessageByRevision) t.assistantMessageByRevision = {}
                if (effectiveRevisionId && t.assistantMessageByRevision) {
                    // Remove the assistant node entirely for this revision to avoid stray renders
                    if (effectiveRevisionId in t.assistantMessageByRevision) {
                        delete t.assistantMessageByRevision[effectiveRevisionId]
                    }
                }
            }),
        )
        // Also clear run status/result hash so UI won't try to display stale assistant content
        if (effectiveRevisionId) {
            setRunStatusMap((prev: any) => {
                const next = {...(prev || {})}
                const key = `${resolvedTurnId}:${effectiveRevisionId}`
                if (key in next) delete next[key]
                return next
            })
        }
        const t = (turnsById as any)?.[turnId]
        const logicalId = t?.logicalTurnId || turnId
        pruneAfterLogical(logicalId)
        pruneLogicalIndex()
    }, [
        effectiveRevisionId,
        pruneAfterLogical,
        pruneLogicalIndex,
        resolvedTurnId,
        setChatTurns,
        setRunStatusMap,
        turnId,
        turnsById,
    ])

    const setUserMessageContent = useSetAtom(setUserMessageContentMutationAtom)

    return (
        <div className={clsx("flex flex-col gap-4", className)}>
            <UserMessageBlock
                variantId={variantId}
                rowId={resolvedTurnId}
                turnId={turnId}
                message={userMessage as any}
                onRerun={() => onRun()}
                onDelete={() => {
                    onDeleteRow()
                    const t = (turnsById as any)?.[turnId]
                    const logicalId = t?.logicalTurnId || turnId
                    pruneAfterLogical(logicalId)
                    pruneLogicalIndex()
                }}
                onChange={(val: string) =>
                    setUserMessageContent({turnId: resolvedTurnId, value: val})
                }
            />

            {withControls ? (
                <ControlsBar
                    isRunning={Boolean(isRunning)}
                    onRun={onRun}
                    onCancel={onCancel}
                    onAddMessage={() => addEmptyTurn()}
                />
            ) : null}

            {isRunning ? (
                // While running, suppress any previous assistant message/error to avoid stale content
                <TypingIndicator />
            ) : hasAssistantContent ? (
                toolCallsView ? (
                    <>
                        <ToolCallView
                            resultData={(result as any)?.response?.data}
                            className="w-full"
                        />
                        {result ? <GenerationResultUtils result={result as any} /> : null}
                    </>
                ) : (
                    <AssistantMessageBlock
                        variantId={variantId}
                        turnId={turnId}
                        assistantMessage={assistantMessage as any}
                        displayAssistantValue={displayAssistantValue}
                        result={result}
                        resultHash={resultHash}
                        onRerun={onRun}
                        onDelete={onDeleteAssistant}
                        toolCallsView={toolCallsView as any}
                        footer={result ? <GenerationResultUtils result={result as any} /> : null}
                        editable={true}
                        isMessageDeletable={true}
                    />
                )
            ) : null}
        </div>
    )
}

export default GenerationChatTurnNormalized
