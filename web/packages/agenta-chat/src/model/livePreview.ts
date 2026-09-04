import {
    createSessionLivePreviewState,
    type SessionLiveFrame,
    type SessionLivePreviewState,
} from "@agenta/entities/session"
import type {UIMessage} from "ai"

type PreviewPart = Record<string, unknown> & {type: string}

/**
 * Insert one temporary frame without assuming delivery order. The relay normally preserves Redis
 * order, but browser reconnects and duplicate fan-out must not duplicate or rewind a preview.
 */
export const reduceSessionLivePreview = (
    state: SessionLivePreviewState,
    frame: SessionLiveFrame,
): SessionLivePreviewState => {
    if (state.seenFrameIds[frame.frame_or_event_id]) return state

    const current = state.byExecution[frame.execution_id]
    if (current?.frames.some((candidate) => candidate.frame_index === frame.frame_index)) {
        return {
            ...state,
            seenFrameIds: {...state.seenFrameIds, [frame.frame_or_event_id]: true},
        }
    }

    const frames = [...(current?.frames ?? []), frame].sort(
        (left, right) => left.frame_index - right.frame_index,
    )
    return {
        executionOrder: current
            ? state.executionOrder
            : [...state.executionOrder, frame.execution_id],
        byExecution: {
            ...state.byExecution,
            [frame.execution_id]: {frames},
        },
        seenFrameIds: {...state.seenFrameIds, [frame.frame_or_event_id]: true},
    }
}

const stringValue = (value: unknown): string =>
    typeof value === "string" ? value : value == null ? "" : String(value)

const applyFrame = (
    parts: PreviewPart[],
    partIndex: Map<string, number>,
    frame: SessionLiveFrame,
): void => {
    const at = partIndex.get(frame.entity_id)
    const current = at === undefined ? undefined : parts[at]
    const update = (part: PreviewPart) => {
        if (at === undefined) {
            partIndex.set(frame.entity_id, parts.length)
            parts.push(part)
        } else {
            parts[at] = part
        }
    }

    switch (frame.type) {
        case "text-start":
            if (!current) update({type: "text", text: ""})
            return
        case "text-delta":
            update({
                type: "text",
                text:
                    stringValue(current?.type === "text" ? current.text : "") +
                    stringValue(frame.payload.delta),
            })
            return
        case "text-end":
            return
        case "reasoning-start":
            if (!current) update({type: "reasoning", text: ""})
            return
        case "reasoning-delta":
            update({
                type: "reasoning",
                text:
                    stringValue(current?.type === "reasoning" ? current.text : "") +
                    stringValue(frame.payload.delta),
            })
            return
        case "reasoning-end":
            return
        case "tool-input-start":
        case "tool-input-available": {
            const toolCallId = stringValue(frame.payload.toolCallId) || frame.entity_id
            const toolName = stringValue(frame.payload.toolName) || "tool"
            update({
                ...(current ?? {}),
                type: "dynamic-tool",
                toolCallId,
                toolName,
                state: frame.type === "tool-input-start" ? "input-streaming" : "input-available",
                input: frame.payload.input ?? current?.input,
            })
            return
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
                update({...base, state: "output-available", output: frame.payload.output})
            } else if (frame.type === "tool-output-error") {
                update({
                    ...base,
                    state: "output-error",
                    errorText: stringValue(frame.payload.errorText),
                })
            } else {
                update({...base, state: "output-denied"})
            }
            return
        }
        default:
            // Forward-compatible clients ignore frame types they do not understand.
            return
    }
}

/** Build disposable UI messages from the ordered frame sets. */
export const sessionLivePreviewMessages = (state: SessionLivePreviewState): UIMessage[] =>
    state.executionOrder.flatMap((executionId) => {
        const execution = state.byExecution[executionId]
        if (!execution) return []
        const parts: PreviewPart[] = []
        const partIndex = new Map<string, number>()
        for (const frame of execution.frames) applyFrame(parts, partIndex, frame)
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
