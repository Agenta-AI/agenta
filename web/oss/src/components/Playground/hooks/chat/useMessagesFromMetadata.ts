import {useMemo} from "react"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"

export const useUserMessageFromMetadata = (
    messageMetadata: any,
    normalizedUserMessage: any,
    userContent: string,
    opts: {turnId: string; userMessageId?: string},
) => {
    return useMemo(() => {
        const val = userContent || ""
        let msg: any
        if (messageMetadata) {
            msg = createMessageFromSchema(messageMetadata as any, {
                role: "user",
                content: {value: val},
            })
        } else {
            msg = {
                __id: opts.userMessageId || `${opts.turnId}-user`,
                role: {value: "user"},
                content: {value: val},
            }
        }
        const u = normalizedUserMessage
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
    }, [messageMetadata, normalizedUserMessage, userContent, opts?.turnId, opts?.userMessageId])
}

export const useAssistantMessageFromMetadata = (
    messageMetadata: any,
    normalizedAssistantMessage: any,
    assistantValue: string,
    opts: {turnIdOrRowId: string},
) => {
    return useMemo(() => {
        const val = assistantValue || ""
        let msg: any
        if (messageMetadata) {
            msg = createMessageFromSchema(messageMetadata as any, {
                role: "assistant",
                content: {value: val},
            })
        } else {
            msg = {
                __id: `${opts.turnIdOrRowId}-assistant`,
                role: {value: "assistant"},
                content: {value: val},
            }
        }
        const a = normalizedAssistantMessage
        if (a?.role?.__id && msg?.role) {
            msg.role.__id = a.role.__id
            if (a.role.__metadata) msg.role.__metadata = a.role.__metadata
        }
        if (a?.content?.__id && msg?.content) {
            msg.content.__id = a.content.__id
            if (a.content.__metadata) msg.content.__metadata = a.content.__metadata
        }
        if (a?.__metadata && msg) {
            msg.__metadata = a.__metadata
        }
        if (!msg.__id && a?.__id) msg.__id = a.__id

        return msg
    }, [messageMetadata, normalizedAssistantMessage, assistantValue, opts?.turnIdOrRowId])
}

export default useUserMessageFromMetadata
