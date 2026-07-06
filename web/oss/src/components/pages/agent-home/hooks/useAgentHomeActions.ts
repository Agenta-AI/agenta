import {useCallback, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {
    captureFirstAgentIntent,
    classifyAgentIntent,
    truncateForCapture,
} from "../assets/onboardingAnalytics"

import {useCreateAgent} from "./useCreateAgent"

/**
 * Composer action handlers (the free-text "describe your agent" path). Template selection is handled
 * separately by the setup drawer. `onCreate` creates the agent and lands in its playground (no drawer),
 * seeding the composer text as the first-run prompt. The "Continue in IDE" handler lives on the page
 * (it opens the IDE-handoff modal — see `useIdeHandoffModal`).
 */
export function useAgentHomeActions(composerRef: RefObject<RichChatInputHandle | null>) {
    const createAgent = useCreateAgent()
    const posthog = usePostHogAg()

    const readPrompt = useCallback(
        () => composerRef.current?.getMarkdown().trim() ?? "",
        [composerRef],
    )

    const onCreate = useCallback(() => {
        const message = readPrompt()
        if (message) {
            captureFirstAgentIntent(posthog, {
                source: "composer",
                properties: {message: truncateForCapture(message)},
                intentValue: classifyAgentIntent(message),
            })
        }
        void createAgent({seedMessage: message})
    }, [createAgent, posthog, readPrompt])

    return {onCreate}
}
