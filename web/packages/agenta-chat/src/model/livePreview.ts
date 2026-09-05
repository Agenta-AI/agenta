import {
    createSessionLivePreviewState,
    type SessionSnapshot,
    type SessionLiveFrame,
    type SessionLivePreviewExecution,
    type SessionLivePreviewState,
} from "@agenta/entities/session"
import type {UIMessage} from "ai"

type PreviewPart = Record<string, unknown> & {type: string}
const SHARED_SENDER_CONTROL_PARTS = new Set(["data-session-accepted", "step-start"])

/** A sender subscribes eagerly; a secondary reader waits for a remote run. */
export const shouldSubscribeToSessionLivePreview = ({
    sharedReaderAdvertised,
    runningElsewhere,
    sender = false,
}: {
    sharedReaderAdvertised: boolean
    runningElsewhere: boolean
    sender?: boolean
}): boolean => sharedReaderAdvertised && (sender || runningElsewhere)

/** Choose the live activity treatment only while the shared reader is actually connected. */
export const deriveRemoteTurnPresentation = ({
    running,
    sharedReaderAdvertised,
    readerReady,
    ownedContinuation = false,
}: {
    running: boolean
    sharedReaderAdvertised: boolean
    readerReady: boolean
    /** This tab answered the gate and owns the continuation even if its invoke stream detached. */
    ownedContinuation?: boolean
}): {showActivity: boolean; showStrip: boolean} => {
    const showActivity = running && sharedReaderAdvertised && readerReady
    return {
        showActivity,
        showStrip: running && !showActivity && !ownedContinuation,
    }
}

/** The shared sender still consumes the invoke response for acceptance ids and errors. The AI SDK
 * creates a message carrier for that control-only stream; keep it out of transcript rendering and
 * local persistence unless it also carries a run error. */
export const withoutSharedSenderAcceptanceMessages = (messages: UIMessage[]): UIMessage[] =>
    messages.filter((message) => {
        const metadata = message.metadata as
            | {sharedSender?: boolean; runError?: unknown}
            | undefined
        if (!metadata?.sharedSender || metadata.runError) return true
        return message.parts.some((part) => !SHARED_SENDER_CONTROL_PARTS.has(part.type))
    })

/** Atomic refresh verdict: the latest execution exists, is not complete, and the session still
 * owns the running flag from the same snapshot read. */
export const isSessionSnapshotRunning = (snapshot: SessionSnapshot | undefined): boolean =>
    snapshot?.session.flags?.is_running === true &&
    snapshot.execution != null &&
    snapshot.execution.end_time == null

const stringValue = (value: unknown): string =>
    typeof value === "string" ? value : value == null ? "" : String(value)

const applyFrame = (
    current: PreviewPart | undefined,
    frame: SessionLiveFrame,
): PreviewPart | undefined => {
    switch (frame.type) {
        case "text-start":
            return current ?? {type: "text", text: ""}
        case "text-delta":
            return {
                type: "text",
                text:
                    stringValue(current?.type === "text" ? current.text : "") +
                    stringValue(frame.payload.delta),
            }
        case "text-end":
            return current
        case "reasoning-start":
            return current ?? {type: "reasoning", text: ""}
        case "reasoning-delta":
            return {
                type: "reasoning",
                text:
                    stringValue(current?.type === "reasoning" ? current.text : "") +
                    stringValue(frame.payload.delta),
            }
        case "reasoning-end":
            return current
        case "tool-input-start":
        case "tool-input-available": {
            const toolCallId = stringValue(frame.payload.toolCallId) || frame.entity_id
            const toolName = stringValue(frame.payload.toolName) || "tool"
            return {
                ...(current ?? {}),
                type: "dynamic-tool",
                toolCallId,
                toolName,
                state: frame.type === "tool-input-start" ? "input-streaming" : "input-available",
                input: frame.payload.input ?? current?.input,
            }
        }
        case "tool-output-available":
        case "tool-output-error":
        case "tool-output-denied": {
            const toolCallId = stringValue(frame.payload.toolCallId) || frame.entity_id
            const base: PreviewPart = {
                ...(current ?? {}),
                type: "dynamic-tool",
                toolCallId,
                toolName: stringValue(current?.toolName) || "tool",
            }
            if (frame.type === "tool-output-available") {
                return {...base, state: "output-available", output: frame.payload.output}
            } else if (frame.type === "tool-output-error") {
                return {
                    ...base,
                    state: "output-error",
                    errorText: stringValue(frame.payload.errorText),
                }
            } else {
                return {...base, state: "output-denied"}
            }
        }
        default:
            // Forward-compatible clients ignore frame types they do not understand.
            return current
    }
}

/** Collapse one ordered frame into bounded per-entity preview state. */
export const reduceSessionLivePreview = (
    state: SessionLivePreviewState,
    frame: SessionLiveFrame,
): SessionLivePreviewState => {
    if (state.gapDetected) return state

    const current = state.byExecution[frame.execution_id]
    if (current && frame.frame_index <= current.lastFrameIndex) return state

    const expectedFrameIndex = current ? current.lastFrameIndex + 1 : 0
    if (frame.frame_index !== expectedFrameIndex) {
        return {...createSessionLivePreviewState(), gapDetected: true}
    }

    const previousPart = current?.byEntity[frame.entity_id]?.part
    const nextPart = applyFrame(previousPart, frame)
    const execution: SessionLivePreviewExecution = current ?? {
        entityOrder: [],
        byEntity: {},
        lastFrameIndex: -1,
    }

    return {
        executionOrder: current
            ? state.executionOrder
            : [...state.executionOrder, frame.execution_id],
        gapDetected: false,
        byExecution: {
            ...state.byExecution,
            [frame.execution_id]: {
                entityOrder:
                    nextPart && !previousPart
                        ? [...execution.entityOrder, frame.entity_id]
                        : execution.entityOrder,
                byEntity: nextPart
                    ? {
                          ...execution.byEntity,
                          [frame.entity_id]: {part: nextPart},
                      }
                    : execution.byEntity,
                lastFrameIndex: frame.frame_index,
            },
        },
    }
}

/** Build disposable UI messages from the collapsed entity state. */
export const sessionLivePreviewMessages = (state: SessionLivePreviewState): UIMessage[] =>
    state.executionOrder.flatMap((executionId) => {
        const execution = state.byExecution[executionId]
        if (!execution) return []
        const parts = execution.entityOrder.flatMap((entityId) => {
            const entity = execution.byEntity[entityId]
            return entity ? [entity.part] : []
        })
        if (parts.length === 0) return []
        return [
            {
                id: `live-preview-${executionId}`,
                role: "assistant",
                parts,
                metadata: {livePreview: true, executionId},
            } as unknown as UIMessage,
        ]
    })

export {createSessionLivePreviewState}
