import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import {CLIENT_TOOL_DESCRIPTORS, canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

import {clientToolMeta} from "./meta"

type ClientToolDescriptor = (typeof CLIENT_TOOL_DESCRIPTORS)[keyof typeof CLIENT_TOOL_DESCRIPTORS]

const getPendingInteractions = (messages: UIMessage[], ...descriptors: ClientToolDescriptor[]) => {
    const message = messages[messages.length - 1]
    if (message?.role !== "assistant") return []
    const renderMap = buildRenderMap(message.parts as {type?: string; data?: unknown}[])
    return message.parts
        .filter((part) => isPendingClientToolInteraction(part, renderMap))
        .map((part) => clientToolMeta(part as ToolUIPart, renderMap))
        .filter((meta) =>
            descriptors.some(
                ({toolName, renderKind}) =>
                    meta.renderKind === renderKind ||
                    canonicalClientToolName(meta.toolName) === toolName,
            ),
        )
}

export const getPendingSecretInteractions = (messages: UIMessage[]) =>
    getPendingInteractions(messages, CLIENT_TOOL_DESCRIPTORS.secret)

export const getPendingBrowserInteractions = (messages: UIMessage[]) =>
    getPendingInteractions(
        messages,
        CLIENT_TOOL_DESCRIPTORS.browser,
        CLIENT_TOOL_DESCRIPTORS.browserLogin,
    )
