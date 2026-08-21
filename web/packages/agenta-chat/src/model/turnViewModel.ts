// Assembled from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx and
// AgentConversation.tsx (2026-07-25): the per-turn derivations the desktop computes inline —
// the tool-parts signature memo key, the executed-identity dedup set, the render-item folding,
// the status derivation, the empty-turn collapse gate, and the borrowed turn trace for user
// rows. Pure so the conversation hook can memoize the whole list per commit.
import type {ToolUIPart, UIMessage} from "ai"

import {getMessageRunError, getMessageRunErrorCode, getMessageTraceId} from "../assets/trace"

import {getTurnGrouping} from "./grouping"
import {isEmptyAssistantTurn, isToolPart} from "./parts"
import {buildTurnRenderItems, executedToolIdentities, type RenderItem} from "./renderModel"
import {deriveTurnStatus, type TurnStatus} from "./turnStatus"

/**
 * The cheap signature the desktop memoizes `executedToolIdentities` on: tool-call id + state
 * per tool part. It stays STABLE while text streams, so the tool-input JSON.stringify behind
 * the identity set doesn't re-run on every streamed token of a tool-heavy turn.
 */
export const toolPartsSignature = (parts: UIMessage["parts"]): string =>
    parts
        .filter((p) => isToolPart(p.type))
        .map((p) => `${(p as ToolUIPart).toolCallId ?? ""}:${(p as ToolUIPart).state ?? ""}`)
        .join("|")

/**
 * Recreates the desktop's per-message `useMemo(executedToolIdentities, [toolSignature])`
 * outside a component: one cache instance per conversation mount, keyed by message id and
 * invalidated only when that message's tool signature changes.
 */
export const createExecutedToolIdentityCache = (): ((message: UIMessage) => Set<string>) => {
    const cache = new Map<string, {sig: string; executed: Set<string>}>()
    return (message) => {
        const sig = toolPartsSignature(message.parts)
        const hit = cache.get(message.id)
        if (hit && hit.sig === sig) return hit.executed
        const executed = executedToolIdentities(message.parts)
        cache.set(message.id, {sig, executed})
        return executed
    }
}

/** Registry-backed client-tool predicate, parameterized: the skin closes over its widget
 * registry + render map the way the desktop message component does. */
export type ClientToolPartPredicate = (
    part: ToolUIPart,
    ctx: {isStreaming: boolean; isLastMessage: boolean},
) => boolean

export interface TurnViewModel {
    message: UIMessage
    /** Position in the conversation (mirrors the messages array). */
    index: number
    isUser: boolean
    isLast: boolean
    /** Part of the active turn group (the last user message + its response). */
    isActive: boolean
    /** This is the turn currently being generated. */
    isStreamingTurn: boolean
    /** Stream-side status (answer/reasoning presence, no-response, run-error surfacing). The
     * trace-side error refinement stays per-turn in the skin, where the trace summary loads. */
    status: TurnStatus
    /** Pre-folded render items (tool grouping, superseded-gate dedup, client-tool split). */
    items: RenderItem[]
    /** The previous message is a settled, contentless assistant turn. */
    precededByEmptyAssistant: boolean
    /** Collapse this row entirely — a repeated empty "no response" turn after another one. */
    hidden: boolean
    /** The turn's own trace id (assistant turns). */
    traceId?: string
    /** A user turn borrows the paired (next) assistant turn's trace for its timestamp. */
    turnTraceId?: string
}

export interface BuildTurnViewModelsContext {
    /** The conversation is submitted/streaming (turn-level streaming derives from position). */
    busy: boolean
    /** Executed-identity resolver — pass a `createExecutedToolIdentityCache()` instance. */
    executedFor: (message: UIMessage) => Set<string>
    /** Defaults to "nothing is a client tool" — parts fold into the regular tool groups. */
    isClientToolPart?: ClientToolPartPredicate
}

/** Derive the full per-turn view model list for one conversation commit. */
export const buildTurnViewModels = (
    messages: UIMessage[],
    {busy, executedFor, isClientToolPart}: BuildTurnViewModelsContext,
): TurnViewModel[] => {
    const {activeStart} = getTurnGrouping(messages)
    return messages.map((message, index) => {
        const isUser = message.role === "user"
        const isLast = index === messages.length - 1
        const isStreamingTurn = busy && isLast
        const status = deriveTurnStatus(message, {
            isUser,
            isStreaming: isStreamingTurn,
            runError: getMessageRunError(message) ?? null,
            errorCode: getMessageRunErrorCode(message) ?? null,
            traceError: null,
        })
        const precededByEmptyAssistant = index > 0 && isEmptyAssistantTurn(messages[index - 1])
        // The empty-turn collapse: only a truly-empty, non-error turn that follows another
        // empty turn is hidden (the first of the run still renders as "no response").
        const hidden =
            status.noResponse && !status.showError && !status.hasContent && precededByEmptyAssistant
        const executed = executedFor(message)
        const items = buildTurnRenderItems(message.parts, {
            executed,
            isClientToolPart: (part) =>
                isClientToolPart
                    ? isClientToolPart(part, {isStreaming: isStreamingTurn, isLastMessage: isLast})
                    : false,
        })
        const traceId = getMessageTraceId(message)
        const turnTraceId =
            isUser && messages[index + 1] ? getMessageTraceId(messages[index + 1]) : undefined
        return {
            message,
            index,
            isUser,
            isLast,
            isActive: index >= activeStart,
            isStreamingTurn,
            status,
            items,
            precededByEmptyAssistant,
            hidden,
            traceId,
            turnTraceId,
        }
    })
}
