import {
    createSessionLivePreviewState,
    type SessionSnapshot,
    type SessionDurableEvent,
    type SessionLiveFrame,
    type SessionLivePreviewExecution,
    type SessionLivePreviewState,
} from "@agenta/entities/session"
import type {UIMessage} from "ai"

type PreviewPart = Record<string, unknown> & {type: string}
const SHARED_SENDER_CONTROL_PARTS = new Set(["data-session-accepted", "step-start"])
const LEGACY_LIVENESS_REFRESH_MS = 10_000

/** Throttle record-driven liveness refreshes used only by flag-off observers. */
export const shouldRefreshLegacyObserverLiveness = ({
    sharedReaderAdvertised,
    lastRefreshAt,
    now,
}: {
    sharedReaderAdvertised: boolean
    lastRefreshAt: number
    now: number
}): boolean => !sharedReaderAdvertised && now - lastRefreshAt >= LEGACY_LIVENESS_REFRESH_MS

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

/** Run activity follows execution state, not whether its reader is connected. */
export const deriveRemoteTurnPresentation = ({
    livenessRunning,
    livenessUpdatedAt = Infinity,
    sharedSettledAt = 0,
    snapshotRunning = false,
    sharedReaderAdvertised,
    readerReady,
    ownedContinuation = false,
}: {
    /** Milestone-1 session-stream liveness; the only running source when the reader is disabled. */
    livenessRunning: boolean
    livenessUpdatedAt?: number
    sharedSettledAt?: number
    /** Atomic shared-reader snapshot state. Ignored while the reader capability is disabled. */
    snapshotRunning?: boolean
    sharedReaderAdvertised: boolean
    readerReady: boolean
    /** This tab answered the gate and owns the continuation even if its invoke stream detached. */
    ownedContinuation?: boolean
}): {showActivity: boolean; showRemoteStop: boolean} => {
    const livenessIsFresh = !sharedReaderAdvertised || livenessUpdatedAt > sharedSettledAt
    const running =
        (livenessRunning && livenessIsFresh) ||
        (sharedReaderAdvertised && (snapshotRunning || ownedContinuation))
    return {
        showActivity: running,
        showRemoteStop: running && !(sharedReaderAdvertised && readerReady) && !ownedContinuation,
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
    snapshot?.session?.flags?.is_running === true &&
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
    const current = state.byExecution[frame.execution_id]
    // Both timestamps originate at the runner: buffered frames can arrive after their done row.
    if (
        current?.terminalCreatedAt &&
        Date.parse(frame.created_at) < Date.parse(current.terminalCreatedAt)
    )
        return state
    if (current && frame.frame_index <= current.lastFrameIndex) return state

    const expectedFrameIndex = current ? current.lastFrameIndex + 1 : 0
    const gap = Boolean(current && frame.frame_index !== expectedFrameIndex)
    const incompleteEntityIds = new Set(current?.incompleteEntityIds ?? [])
    if (gap) {
        for (const [id, entity] of Object.entries(current?.byEntity ?? {})) {
            if (entity.part.type === "text" || entity.part.type === "reasoning")
                incompleteEntityIds.add(id)
        }
    }
    const isDelta = frame.type === "text-delta" || frame.type === "reasoning-delta"
    if (isDelta && (gap || (!current?.byEntity[frame.entity_id] && frame.frame_index !== 0)))
        incompleteEntityIds.add(frame.entity_id)
    if (frame.type === "text-start" || frame.type === "reasoning-start")
        incompleteEntityIds.delete(frame.entity_id)

    const previousPart = current?.byEntity[frame.entity_id]?.part
    const nextPart = current?.retiredEntityIds?.includes(frame.entity_id)
        ? undefined
        : incompleteEntityIds.has(frame.entity_id) && isDelta
          ? previousPart
          : applyFrame(previousPart, frame)
    const execution: SessionLivePreviewExecution = current ?? {
        entityOrder: [],
        byEntity: {},
        lastFrameIndex: -1,
    }

    return {
        executionOrder: current
            ? state.executionOrder
            : [...state.executionOrder, frame.execution_id],
        gapDetected: state.gapDetected || gap,
        byExecution: {
            ...state.byExecution,
            [frame.execution_id]: {
                ...execution,
                entityOrder:
                    nextPart && !previousPart
                        ? [...execution.entityOrder, frame.entity_id]
                        : execution.entityOrder,
                byEntity: nextPart
                    ? {
                          ...execution.byEntity,
                          [frame.entity_id]: {
                              part: nextPart,
                              complete: [
                                  "text-end",
                                  "reasoning-end",
                                  "tool-output-available",
                                  "tool-output-error",
                              ].includes(frame.type),
                          },
                      }
                    : execution.byEntity,
                lastFrameIndex: frame.frame_index,
                incompleteEntityIds: [...incompleteEntityIds],
            },
        },
    }
}

/** A prompt boundary closes its old entities, but leaves their text visible until adoption. */
export const markSessionLivePreviewTerminal = (
    state: SessionLivePreviewState,
    event: Pick<SessionDurableEvent, "execution_id" | "created_at">,
): SessionLivePreviewState => {
    const executionId = event.execution_id
    const execution = state.byExecution[executionId] ?? {
        entityOrder: [],
        byEntity: {},
        lastFrameIndex: -1,
    }
    return {
        ...state,
        executionOrder: state.executionOrder.includes(executionId)
            ? state.executionOrder
            : [...state.executionOrder, executionId],
        byExecution: {
            ...state.byExecution,
            [executionId]: {
                ...execution,
                lastFrameIndex: -1,
                terminalCreatedAt: event.created_at,
                retiredEntityIds: [
                    ...new Set([...(execution.retiredEntityIds ?? []), ...execution.entityOrder]),
                ],
            },
        },
    }
}

/** Retire only output captured before adoption; a resumed prompt can already be streaming. */
export const retireSessionLivePreview = (
    state: SessionLivePreviewState,
    event: SessionDurableEvent,
    boundary: SessionLivePreviewState = state,
    adoptedMessages: UIMessage[] = [],
): SessionLivePreviewState => {
    const terminal = ["execution.stopped", "execution.failed", "execution.lost"].includes(
        event.type,
    )
    const entityId =
        event.type === "message.completed"
            ? event.payload.message_id
            : event.type === "tool.completed"
              ? event.payload.tool_call_id
              : undefined
    if (!terminal && typeof entityId !== "string") return state
    const execution = state.byExecution[event.execution_id] ?? {
        entityOrder: [],
        byEntity: {},
        lastFrameIndex: -1,
    }
    const captured = boundary.byExecution[event.execution_id]
    const durableReasoning = new Set(
        adoptedMessages.flatMap((message) =>
            message.parts.flatMap((part) => (part.type === "reasoning" ? [part.text] : [])),
        ),
    )
    const capturedReasoning = (captured?.entityOrder ?? []).filter((id) => {
        const part = captured?.byEntity[id]?.part
        return (
            captured?.byEntity[id]?.complete === true &&
            part?.type === "reasoning" &&
            durableReasoning.has(String(part.text))
        )
    })
    const candidates = terminal
        ? (captured?.entityOrder ?? [])
        : [entityId as string, ...capturedReasoning]
    const retired = candidates.filter(
        (id) => execution.byEntity[id]?.part === captured?.byEntity[id]?.part,
    )
    const byEntity = {...execution.byEntity}
    for (const id of retired) delete byEntity[id]
    return {
        ...state,
        executionOrder: state.executionOrder.includes(event.execution_id)
            ? state.executionOrder
            : [...state.executionOrder, event.execution_id],
        byExecution: {
            ...state.byExecution,
            [event.execution_id]: {
                ...execution,
                entityOrder: execution.entityOrder.filter((id) => !retired.includes(id)),
                byEntity,
                retiredEntityIds: [...new Set([...(execution.retiredEntityIds ?? []), ...retired])],
            },
        },
    }
}

/** Reconcile a running snapshot without dropping parts absent from its committed record prefix. */
export const retireCoveredSessionLivePreview = (
    state: SessionLivePreviewState,
    boundary: SessionLivePreviewState,
    coveredEntityIds: ReadonlySet<string>,
    adoptedMessages: UIMessage[],
): SessionLivePreviewState => {
    const durableReasoning = new Set(
        adoptedMessages.flatMap((message) =>
            message.parts.flatMap((part) => (part.type === "reasoning" ? [part.text] : [])),
        ),
    )
    const byExecution = {...state.byExecution}
    for (const executionId of boundary.executionOrder) {
        const captured = boundary.byExecution[executionId]
        const current = state.byExecution[executionId]
        if (!captured || !current) continue
        const retired = captured.entityOrder.filter((id) => {
            const entity = captured.byEntity[id]
            if (!entity || current.byEntity[id]?.part !== entity.part) return false
            return (
                coveredEntityIds.has(id) ||
                (entity.complete === true &&
                    entity.part.type === "reasoning" &&
                    durableReasoning.has(String(entity.part.text)))
            )
        })
        if (!retired.length) continue
        const byEntity = {...current.byEntity}
        for (const id of retired) delete byEntity[id]
        byExecution[executionId] = {
            ...current,
            byEntity,
            entityOrder: current.entityOrder.filter((id) => !retired.includes(id)),
            retiredEntityIds: [...new Set([...(current.retiredEntityIds ?? []), ...retired])],
        }
    }
    return {...state, byExecution}
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
