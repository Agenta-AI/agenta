import {useCallback, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {App} from "antd"

import {buildIdeCommand} from "../assets/constants"

/**
 * Composer action handlers (the free-text "describe your agent" path). Template selection
 * is handled separately by the setup drawer. `onCreate` is a stub until the create flow lands.
 */
export function useAgentHomeActions(composerRef: RefObject<RichChatInputHandle | null>) {
    const {message} = App.useApp()

    const readPrompt = useCallback(
        () => composerRef.current?.getMarkdown().trim() ?? "",
        [composerRef],
    )

    const onContinueInIde = useCallback(async () => {
        const command = buildIdeCommand(readPrompt())
        try {
            await navigator.clipboard.writeText(command)
            message.success("Copied install command + prompt to your clipboard")
        } catch {
            message.error("Couldn't copy to clipboard")
        }
    }, [readPrompt, message])

    // TODO: wire to the create-agent flow (auto-name → navigate to playground).
    const onCreate = useCallback(() => {
        message.info("Agent creation is being wired up")
    }, [message])

    return {onCreate, onContinueInIde}
}
