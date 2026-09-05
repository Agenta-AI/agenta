import type {PendingSessionInput, SessionSnapshot} from "@agenta/entities/session"
import type {FileUIPart} from "ai"

import type {QueuedMessage} from "../hooks/useAgentChatQueue"

export interface SessionPendingInputView {
    capabilities: {queue: boolean; steer: boolean}
    executionState: "idle" | "running" | "stopping"
    queued: QueuedMessage[]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

const filePartFromBlock = (block: Record<string, unknown>): FileUIPart | null => {
    const url = block.uri ?? block.url
    if (typeof url !== "string" || !url) return null
    return {
        type: "file",
        url,
        mediaType:
            typeof block.mime_type === "string"
                ? block.mime_type
                : typeof block.mediaType === "string"
                  ? block.mediaType
                  : "application/octet-stream",
        filename: typeof block.filename === "string" ? block.filename : undefined,
    }
}

export const pendingInputToQueuedMessage = (input: PendingSessionInput): QueuedMessage | null => {
    const data = asRecord(input.content.data)
    const inputs = asRecord(data?.inputs)
    const messages = Array.isArray(inputs?.messages) ? inputs.messages : []
    const message = [...messages]
        .reverse()
        .map(asRecord)
        .find((candidate) => candidate?.role === "user")
    if (!message || !input.id) return null

    let text = ""
    const fileParts: FileUIPart[] = []
    let attachmentCount = 0
    if (typeof message.content === "string") {
        text = message.content
    } else if (Array.isArray(message.content)) {
        for (const raw of message.content) {
            const block = asRecord(raw)
            if (!block) continue
            if (block.type === "text" && typeof block.text === "string") text += block.text
            if (["attachment", "image", "resource"].includes(String(block.type))) {
                attachmentCount += 1
                const part = filePartFromBlock(block)
                if (part) fileParts.push(part)
            }
        }
    } else if (Array.isArray(message.parts)) {
        for (const raw of message.parts) {
            const part = asRecord(raw)
            if (!part) continue
            if (part.type === "text" && typeof part.text === "string") text += part.text
            if (part.type === "file") {
                attachmentCount += 1
                const filePart = filePartFromBlock(part)
                if (filePart) fileParts.push(filePart)
            }
        }
    }

    return {
        id: input.id,
        text,
        fileParts: fileParts.length ? fileParts : undefined,
        attachmentCount,
        policy: input.policy,
        source: "server",
        editable: false,
    }
}

export const reduceSessionPendingInputs = (
    snapshot: SessionSnapshot | null,
): SessionPendingInputView => ({
    capabilities: {
        queue: snapshot?.capabilities.queue ?? false,
        steer: snapshot?.capabilities.steer ?? false,
    },
    executionState: snapshot?.execution_state.state ?? "idle",
    queued: (snapshot?.pending.inputs ?? [])
        .filter((input) => input.state === "pending" || input.state === "promoted")
        .sort((left, right) => left.position - right.position)
        .map(pendingInputToQueuedMessage)
        .filter((input): input is QueuedMessage => input !== null),
})
