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
export function useAgentHomeActions(
    composerRef: RefObject<RichChatInputHandle | null>,
    options?: {
        /** Auto-send the seed once the playground is ready (strip-era home behavior). */
        autoSendSeed?: boolean
    },
) {
    const createAgent = useCreateAgent()
    const posthog = usePostHogAg()
    const autoSendSeed = options?.autoSendSeed

    const readPrompt = useCallback(
        () => composerRef.current?.getMarkdown().trim() ?? "",
        [composerRef],
    )

    const onCreate = useCallback(
        // `prompt` overrides the ref read for Enter-submit, where the editor has already
        // serialized + cleared itself and hands the markdown to the submit callback.
        (templateName?: string, prompt?: string) => {
            const message = prompt?.trim() || readPrompt()
            if (message) {
                captureFirstAgentIntent(posthog, {
                    source: "composer",
                    properties: {message: truncateForCapture(message)},
                    intentValue: classifyAgentIntent(message),
                })
            }
            void createAgent({name: templateName, seedMessage: message, autoSendSeed})
        },
        [createAgent, posthog, readPrompt, autoSendSeed],
    )

    return {onCreate}
}
