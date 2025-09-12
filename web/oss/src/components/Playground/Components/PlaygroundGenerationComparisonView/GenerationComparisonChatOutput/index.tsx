import {useCallback, useEffect, useMemo} from "react"

import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import AddButton from "@/oss/components/Playground/assets/AddButton"
import RunButton from "@/oss/components/Playground/assets/RunButton"
import TypingIndicator from "@/oss/components/Playground/assets/TypingIndicator"
// getTextContent not needed after assistant hooks integration
import AssistantMessageBlock from "@/oss/components/Playground/Components/ChatCommon/AssistantMessageBlock"
import UserMessageBlock from "@/oss/components/Playground/Components/ChatCommon/UserMessageBlock"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
// assistant helpers are consumed via useAssistantArtifacts
import useAssistantArtifacts from "@/oss/components/Playground/hooks/chat/useAssistantArtifacts"
import {useAssistantMessage} from "@/oss/components/Playground/hooks/chat/useAssistantMessage"
import useCancelControls from "@/oss/components/Playground/hooks/chat/useCancelControls"
import useDeleteLogicalRow from "@/oss/components/Playground/hooks/chat/useDeleteLogicalRow"
import useMessageMetadata from "@/oss/components/Playground/hooks/chat/useMessageMetadata"
import {useAssistantMessageFromMetadata} from "@/oss/components/Playground/hooks/chat/useMessagesFromMetadata"
import useRowIdForVariant from "@/oss/components/Playground/hooks/chat/useRowIdForVariant"
import useRunControls from "@/oss/components/Playground/hooks/chat/useRunControls"
import useRunResult from "@/oss/components/Playground/hooks/chat/useRunResult"
import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {usePlaygroundLayout} from "@/oss/components/Playground/hooks/usePlaygroundLayout"
import {
    displayedVariantsAtom,
    pendingWebWorkerRequestsAtom,
} from "@/oss/components/Playground/state/atoms"
import {
    addEmptyChatTurnMutationAtom,
    normalizeComparisonChatTurnsMutationAtom,
    pruneLogicalTurnIndexForDisplayedVariantsMutationAtom,
    pruneTurnsAfterLogicalIdMutationAtom,
} from "@/oss/components/Playground/state/atoms/generationMutations"
import {chatHistorySelectorFamily} from "@/oss/components/Playground/state/selectors/history"
import {inputRowIdsWithPropertiesCompatAtom} from "@/oss/state/generation/compat"
import {
    chatTurnsByIdAtom,
    logicalTurnIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"
import {chatSessionsByIdAtom} from "@/oss/state/generation/entities"
// assistant selector family no longer used directly; using useAssistantMessage hook

import {normalizeEmptyTailMessageShapeAtom} from "../../../state/atoms/mutations/chat/normalizeEmptyTail"
import {
    setUserMessageContentMutationAtom,
    setUserMessageContentForLogicalDisplayedMutationAtom,
} from "../../../state/atoms/mutations/chat/setUserMessageContent"
import {expectedRoundByLogicalAtom} from "../../../state/atoms/orchestration/expected"
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"

import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputCellProps} from "./types"

// No local schema plumbing; PromptMessageConfig derives structure internally

// Auxiliary controls visible only for the last baseline turn
const LastTurnControls = ({
    turnId,
    baselineSessionTurnId,
    displayedVariantIds,
    isAnyRunning,
    onRun,
    onCancelAll,
    onAddMessage,
}: {
    turnId: string
    baselineSessionTurnId: string
    displayedVariantIds?: string[]
    isAnyRunning: boolean
    onRun: () => void
    onCancelAll: () => void
    onAddMessage: () => void
}) => {
    // Show controls only if THIS logical row is last across ALL displayed revisions
    const isLastAtom = useMemo(
        () =>
            atom((get) => {
                const displayed = (displayedVariantIds || []) as string[]
                if (!Array.isArray(displayed) || displayed.length === 0) return false
                const sessions = get(chatSessionsByIdAtom) as Record<string, any>
                const map = (get(logicalTurnIndexAtom)?.[turnId] || {}) as Record<string, string>
                // If there is an expected round pending for this logical turn (fanout),
                // treat it as aligned so controls remain visible during rerun
                const expected = (get(expectedRoundByLogicalAtom) || {}) as Record<string, any>
                if (expected[turnId]) return true
                // For each displayed revision:
                // - If session has no turns yet => consider aligned (true)
                // - If mappedId exists: aligned if lastId === mappedId OR last turn is an empty user input
                // - If no mappedId (sibling not mapped yet) => consider aligned; it will align on append
                return displayed.every((revId) => {
                    const sid = `session-${revId}`
                    const sess = sessions?.[sid]
                    const ids = (sess?.turnIds || []).filter(Boolean)
                    if (ids.length === 0) return true
                    const lastId = ids[ids.length - 1]
                    const mappedId =
                        map[revId] ||
                        (revId === displayed[0] ? baselineSessionTurnId || turnId : "")
                    if (!mappedId) return true
                    if (lastId === mappedId) return true
                    // allow if last turn is an empty user input (pre-aligned tail)
                    const turns = get(chatTurnsByIdAtom) as Record<string, any>
                    const last = turns[lastId]
                    const user = last?.userMessage
                    const v = user?.content?.value
                    const isEmpty =
                        (typeof v === "string" && v.trim().length === 0) ||
                        (Array.isArray(v) && v.length === 0)
                    return Boolean(isEmpty)
                })
            }),
        [baselineSessionTurnId, displayedVariantIds, turnId],
    )
    const isLast = useAtomValue(isLastAtom)

    // Keep controls visible while any cell is running for this logical row
    if (!isLast && !isAnyRunning) return null

    return (
        <div className="flex items-center gap-2">
            {!isAnyRunning ? (
                <RunButton onClick={onRun} size="small" />
            ) : (
                <RunButton isCancel onClick={onCancelAll} size="small" />
            )}
            <AddButton onClick={onAddMessage} size="small" label="Message" />
        </div>
    )
}

const GenerationComparisonChatOutputCell = ({
    variantId,
    turnId,
    variantIndex,
    isFirstRow,
}: GenerationComparisonChatOutputCellProps) => {
    // Trace render for this row/cell
    const inputRowIds = useAtomValue(inputRowIdsWithPropertiesCompatAtom)
    // Direct logical-turn mapping: turnId here IS the logicalTurnId
    const logicalMapAtom = useMemo(
        () => atom((get) => (get(logicalTurnIndexAtom)?.[turnId] || {}) as Record<string, string>),
        [turnId],
    )
    const logicalMap = useAtomValue(logicalMapAtom)
    const displayedVariantIds = useAtomValue(displayedVariantsAtom)

    // Deterministic per-cell run status based on baseline logical id mapping
    // Compute logical id suffix from baseline turnId for matching rows across revisions
    const logicalSuffix = useMemo(() => {
        const anchor = "-lt-"
        const pos = turnId.indexOf(anchor)
        return pos >= 0 ? turnId.substring(pos + 1) : ""
    }, [turnId])

    // No suffix-based fallback; logical index is the source of truth
    // For the column's revision, use mapped session id; fallback to baseline turnId when matching baseline
    const sessionTurnIdAtom = useMemo(
        () => atom((get) => (get(logicalTurnIndexAtom)?.[turnId]?.[variantId] || "") as string),
        [turnId, variantId],
    )
    const sessionTurnId = useAtomValue(sessionTurnIdAtom)
    const assistant = useAssistantMessage({
        turnId: sessionTurnId || turnId,
        revisionId: variantId,
    }) as any

    // Per-cell run status and result (must be available before using for display/tool views)
    const rowIdForVariant = useRowIdForVariant({
        sessionTurnId,
        logicalMap: logicalMap as any,
        variantId: variantId as string,
        turnId,
    })
    const {isRunning, resultHash, result} = useRunResult({
        rowId: rowIdForVariant,
        variantId: variantId as string,
    })

    // Extra: consider pending worker requests per cell (variant + logical suffix)
    const pendingCellAtom = useMemo(
        () =>
            atom((get) => {
                const pending = get(pendingWebWorkerRequestsAtom) || {}
                const suffix = logicalSuffix
                return Object.values(pending).some((p: any) => {
                    if (!p) return false
                    if (p.variantId !== variantId) return false
                    const row = String(p.rowId || "")
                    return suffix ? row.endsWith(suffix) : row === sessionTurnId
                })
            }),
        [logicalSuffix, variantId, sessionTurnId],
    )
    const isPendingRunningCell = useAtomValue(pendingCellAtom) as boolean

    // Assistant string from normalized content or result payload
    const {displayAssistantValue, toolCallsView} = useAssistantArtifacts(assistant, result)

    // Build assistant message node similar to single view for proper role/content rendering
    // moved below after messageMetadata declaration

    // Read user message ids for the first column's session turn
    const userIdsAtom = useMemo(
        () =>
            atom((get) => {
                const turn = get(chatTurnsByIdAtom)[sessionTurnId]
                const uid = turn?.userMessage?.__id || `${turnId}-user`
                const contentId = turn?.userMessage?.content?.__id || `content-${turnId}`
                const value = turn?.userMessage?.content?.value || ""
                return {userId: uid as string, contentId: contentId as string, value}
            }),
        [sessionTurnId, turnId],
    )
    const {userId: userMessageId, value: directUserContentValue} = useAtomValue(userIdsAtom)
    // Use normalized history selector to derive user content when direct value is empty
    const anchorId = sessionTurnId || turnId
    const historyForCell = useAtomValue(
        useMemo(
            () =>
                chatHistorySelectorFamily({revisionId: variantId as string, untilTurnId: anchorId}),
            [variantId, anchorId],
        ),
    ) as any[]
    const derivedUserContentValue = useMemo(() => {
        const v: any = directUserContentValue
        const isNonEmpty = (val: any) =>
            (typeof val === "string" && val.trim().length > 0) ||
            (Array.isArray(val) && val.length > 0)
        if (isNonEmpty(v)) return v
        try {
            // Take the last user message in the selector-built history (should be the current logical turn)
            const lastUser = [...(historyForCell || [])]
                .reverse()
                .find((m: any) => m?.role === "user")
            return lastUser?.content ?? ""
        } catch {
            return ""
        }
    }, [directUserContentValue, historyForCell])
    // no local write of turns; use shared mutation
    const setUserMessageContent = useSetAtom(setUserMessageContentMutationAtom)
    const setUserMessageContentForLogicalDisplayed = useSetAtom(
        setUserMessageContentForLogicalDisplayedMutationAtom,
    )
    const {runForRevisions} = useRunControls()
    const {onCancelAll} = useCancelControls()
    const addEmptyTurn = useSetAtom(addEmptyChatTurnMutationAtom)
    const normalizeTurns = useSetAtom(normalizeComparisonChatTurnsMutationAtom)
    const pruneLogicalIndex = useSetAtom(pruneLogicalTurnIndexForDisplayedVariantsMutationAtom)
    const pruneAfterLogical = useSetAtom(pruneTurnsAfterLogicalIdMutationAtom)

    // Mapping of logical turn to per-revision session turns (no local change handler in comparison view)

    const turnsById = useAtomValue(chatTurnsByIdAtom)
    const sessionsById = useAtomValue(chatSessionsByIdAtom)
    const setExpected = useSetAtom(expectedRoundByLogicalAtom)
    const onRun = useCallback(() => {
        // Comparison whole-row run: prune all turns after this logical row across displayed revisions
        pruneAfterLogical(turnId)
        const mapping = logicalMap as Record<string, string>
        const mappedRowIds: Record<string, string> = {}
        ;(displayedVariantIds || []).forEach((rid: string) => {
            mappedRowIds[rid] = mapping[rid]
        })
        // Immediately normalize rows and prune index like Run all does
        normalizeTurns()
        pruneLogicalIndex()
        normalizeEmpty()

        const displayed = displayedVariantIds || []
        // Clear any prior expected round for this logical row before setting fanout
        setExpected((prev: any) => {
            const next = {...prev}
            if (next[turnId]) delete next[turnId]
            return next
        })
        if (Array.isArray(displayed) && displayed.length > 1) {
            // Whole-row (fanout) run: mark expected round so orchestrator appends after both complete
            setExpected((prev: any) => ({
                ...prev,
                [turnId]: {
                    expectedRevIds: displayed,
                    roundId: `${turnId}:${displayed.join("+")}`,
                    origin: "fanout",
                },
            }))
        }

        runForRevisions(
            turnId,
            displayed,
            logicalMap as any,
            undefined,
            sessionTurnId,
            turnId,
            turnsById as any,
            sessionsById as any,
        )
    }, [
        displayedVariantIds,
        logicalMap,
        runForRevisions,
        sessionTurnId,
        turnId,
        turnsById,
        sessionsById,
        setExpected,
        pruneAfterLogical,
    ])

    // Cell-level rerun for this variant only
    const onRunCell = useCallback(() => {
        runForRevisions(
            turnId,
            [variantId],
            logicalMap as any,
            undefined,
            sessionTurnId,
            turnId,
            turnsById as any,
            sessionsById as any,
        )
    }, [logicalMap, runForRevisions, sessionTurnId, turnId, turnsById, sessionsById, variantId])

    // Aggregate running state across all displayed variants for this logical turn
    const anyRunningAtom = useMemo(
        () =>
            atom((get) => {
                const all = get(runStatusByRowRevisionAtom) || {}
                const displayed = (get(displayedVariantsAtom) || []) as string[]
                const map = get(logicalTurnIndexAtom)?.[turnId] || {}
                return displayed.some((vid) => {
                    const sid = (map as any)[vid]
                    if (!sid) return false
                    const st = (all as any)[`${sid}:${vid}`]
                    return Boolean(st?.isRunning)
                })
            }),
        [turnId],
    )
    // Also consider pending web worker requests for this logical turn
    const anyPendingAtom = useMemo(
        () =>
            atom((get) => {
                const pending = get(pendingWebWorkerRequestsAtom) || {}
                const displayed = (get(displayedVariantsAtom) || []) as string[]
                const map = get(logicalTurnIndexAtom)?.[turnId] || {}
                const sids = displayed.map((vid) => (map as any)[vid]).filter(Boolean)
                return Object.values(pending).some((p: any) => sids.includes(p?.rowId))
            }),
        [turnId],
    )
    const anyRunning = useAtomValue(anyRunningAtom)
    const anyPending = useAtomValue(anyPendingAtom)
    const isAnyRunning = anyRunning || anyPending

    // PromptMessageConfig will derive message structure; we only broadcast changes

    // Normalize existing turns whenever displayed variants change to avoid stale/broken role/content
    const normalizeEmpty = useSetAtom(normalizeEmptyTailMessageShapeAtom)
    useEffect(() => {
        normalizeTurns()
        pruneLogicalIndex()
        // Also normalize any existing malformed empty-tail user messages (e.g., from single->comparison)
        normalizeEmpty()
    }, [normalizeTurns, (displayedVariantIds || []).join(",")])

    // Prepare proper user message shape similar to single view via shared hook
    const messageMetadata = useMessageMetadata(variantId)

    const assistantMessageNode = useAssistantMessageFromMetadata(
        messageMetadata,
        assistant,
        displayAssistantValue || "",
        {turnIdOrRowId: sessionTurnId || turnId},
    )

    // Only render assistant message component when we actually have assistant content
    const {hasAssistantContent} = useAssistantArtifacts(assistant, result)

    const normalizedTurnAtom = useMemo(
        () => atom((get) => (sessionTurnId ? get(chatTurnsByIdAtom)[sessionTurnId] : null) as any),
        [sessionTurnId],
    )
    const normalizedTurn = useAtomValue(normalizedTurnAtom) as any

    const userMessageNode = useMemo(() => {
        const val = derivedUserContentValue || ""
        let msg: any
        if (messageMetadata) {
            msg = createMessageFromSchema(messageMetadata as any, {
                role: "user",
                content: {value: val},
            })
        } else {
            msg = {
                __id: userMessageId,
                role: {value: "user"},
                content: {value: val},
            }
        }
        const u = normalizedTurn?.userMessage
        if (u?.role?.__id && msg?.role) {
            msg.role.__id = u.role.__id
            if (u.role.__metadata) msg.role.__metadata = u.role.__metadata
        }
        if (u?.content?.__id && msg?.content) {
            msg.content.__id = u.content.__id
            if (u.content.__metadata) msg.content.__metadata = u.content.__metadata
        }
        if (u?.__metadata && msg) {
            msg.__metadata = u.__metadata
        }
        if (!msg.__id && u?.__id) msg.__id = u.__id

        return msg
    }, [messageMetadata, derivedUserContentValue, normalizedTurn?.userMessage, userMessageId])

    // Delete the whole logical row across all displayed revisions via shared hook
    const {useDeleteWholeRow} = useDeleteLogicalRow()
    const deleteWholeRow = useDeleteWholeRow(turnId, sessionTurnId || null)

    return (
        <>
            <div
                className={clsx([
                    "shrink-0 flex flex-col self-stretch sticky left-0 z-[4] bg-white border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-r": variantIndex === 0},
                ])}
            >
                {variantIndex === 0 && (
                    <div className="!w-[399.2px] shrink-0 sticky top-9 z-[2]">
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

                        <div className="p-3 flex flex-col gap-2">
                            <UserMessageBlock
                                variantId={variantId as string}
                                rowId={sessionTurnId || turnId}
                                turnId={turnId}
                                message={userMessageNode as any}
                                onRerun={() => {
                                    // prune future turns and rerun
                                    pruneAfterLogical(turnId)
                                    onRun()
                                }}
                                onDelete={deleteWholeRow}
                                onChange={(val: string) => {
                                    if (variantIndex === 0) {
                                        // Baseline column: sync user message across displayed revisions for this logical row
                                        setUserMessageContentForLogicalDisplayed({
                                            logicalId: turnId,
                                            value: val,
                                        })
                                    } else {
                                        // Non-baseline: only update this cell's session turn
                                        const rid = sessionTurnId || turnId
                                        setUserMessageContent({turnId: rid, value: val})
                                    }
                                }}
                            />
                            {/** Show controls only for the last turn in baseline session */}
                            <LastTurnControls
                                turnId={turnId}
                                baselineSessionTurnId={sessionTurnId || turnId}
                                displayedVariantIds={displayedVariantIds}
                                isAnyRunning={isAnyRunning}
                                onRun={onRun}
                                onCancelAll={onCancelAll}
                                onAddMessage={() => {
                                    addEmptyTurn()
                                    normalizeTurns()
                                    pruneLogicalIndex()
                                }}
                            />
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
                    {isPendingRunningCell || isRunning ? (
                        <TypingIndicator size="small" />
                    ) : hasAssistantContent ? (
                        <>
                            <AssistantMessageBlock
                                variantId={variantId}
                                turnId={sessionTurnId || (logicalMap || {})[variantId] || turnId}
                                assistantMessage={assistantMessageNode as any}
                                displayAssistantValue={displayAssistantValue}
                                result={result}
                                resultHash={resultHash}
                                toolCallsView={toolCallsView as any}
                                editable
                                onRerun={onRunCell}
                                messageProps={{
                                    className:
                                        "!p-0 [&_.agenta-editor-wrapper]:!p-3 !mt-0 [&:nth-child(1)]:!mt-0 mt-2",
                                    editorClassName: "!p-3",
                                    headerClassName:
                                        "min-h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                                    footerClassName: "px-3 h-[48px] !m-0",
                                }}
                            />
                            {result ? <GenerationResultUtils result={result as any} /> : null}
                        </>
                    ) : (
                        <div>
                            <SharedEditor
                                initialValue={"Click run to generate output"}
                                editorType="borderless"
                                readOnly
                                disabled
                            />
                        </div>
                    )}
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
