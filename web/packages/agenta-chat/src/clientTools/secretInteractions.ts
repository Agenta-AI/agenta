import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

import {clientToolMeta} from "./meta"

export const getPendingSecretInteractions = (messages: UIMessage[]) => {
    const message = messages[messages.length - 1]
    if (message?.role !== "assistant") return []
    const renderMap = buildRenderMap(message.parts as {type?: string; data?: unknown}[])
    return message.parts
        .filter((part) => isPendingClientToolInteraction(part, renderMap))
        .map((part) => clientToolMeta(part as ToolUIPart, renderMap))
        .filter(
            (meta) =>
                meta.renderKind === "secret" ||
                canonicalClientToolName(meta.toolName) === "request_secret",
        )
}
