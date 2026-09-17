import {useCallback, type RefObject} from "react"

import type {AgentSetupSelection} from "@agenta/entities/workflow"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {agentNameFromTask} from "../assets/agentName"
import {captureFirstAgentIntent, classifyAgentIntent} from "../assets/onboardingAnalytics"

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
        // `setup` is what the pre-create connect step decided, when it ran.
        (templateName?: string, prompt?: string, setup?: AgentSetupSelection) => {
            const message = prompt?.trim() || readPrompt()
            if (message) {
                captureFirstAgentIntent(posthog, {
                    source: "composer",
                    intentValue: classifyAgentIntent(message),
                })
            }
            // A template names the agent after itself; free text names it after the task. Without
            // this every composer-created agent was literally called "New agent", which made the
            // roster and the session list's agent column carry no information.
            return createAgent({
                name: templateName || agentNameFromTask(message) || undefined,
                seedMessage: message,
                autoSendSeed,
                setup,
            })
        },
        [createAgent, posthog, readPrompt, autoSendSeed],
    )

    return {onCreate}
}
