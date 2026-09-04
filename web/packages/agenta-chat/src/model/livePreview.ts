import {
    createSessionLivePreviewState,
    type SessionLiveFrame,
    type SessionLivePreviewExecution,
    type SessionLivePreviewState,
} from "@agenta/entities/session"
import type {UIMessage} from "ai"

type PreviewPart = Record<string, unknown> & {type: string}

/** The reader is useful only for a backend-advertised run owned by another browser. */
export const shouldSubscribeToSessionLivePreview = ({
    sharedReaderAdvertised,
    runningElsewhere,
}: {
    sharedReaderAdvertised: boolean
    runningElsewhere: boolean
}): boolean => sharedReaderAdvertised && runningElsewhere

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
