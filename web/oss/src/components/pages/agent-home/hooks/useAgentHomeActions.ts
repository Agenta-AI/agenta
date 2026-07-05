import {useCallback, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {App} from "antd"

import {buildIdeCommand} from "../assets/constants"

import {useCreateAgent} from "./useCreateAgent"

/**
 * Composer action handlers (the free-text "describe your agent" path). Template selection is handled
 * separately by the setup drawer. `onCreate` creates the agent and lands in its playground (no drawer),
 * seeding the composer text as the first-run prompt.
 */
export function useAgentHomeActions(composerRef: RefObject<RichChatInputHandle | null>) {
    const {message} = App.useApp()
    const createAgent = useCreateAgent()

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

    const onCreate = useCallback(() => {
        void createAgent({seedMessage: readPrompt()})
    }, [createAgent, readPrompt])

    return {onCreate, onContinueInIde}
}
