import {useEffect, useRef, useState} from "react"

import {useAtomValue} from "jotai"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {
    activeTemplateAtom,
    claimTemplate,
    clearTemplate,
    resolveTemplate,
} from "@/oss/state/url/template"

import {captureFirstAgentIntent} from "../assets/onboardingAnalytics"

import {useCreateAgent} from "./useCreateAgent"

/**
 * Consume a pending website template at whichever first-run surface the user reaches. A new user
 * lands on the native onboarding playground and a returning user on the agent home page, so this
 * hook is mounted above both and consumes the key wherever the user actually is.
 *
 * Returns `true` while a valid template is being consumed, so the caller can hold the onboarding
 * loader instead of flashing the normal surface (which would fire its own redirect and race this).
 *
 * The steps mirror the plan's consume requirements: validate the key by exact registry lookup
 * (an unknown or stale key is ignored and cleared, never creating an agent); wait for a confirmed
 * workspace and project; claim the key so it fires at most once; then create the agent with the
 * seed held behind a Start button (`autoSendSeed: false`).
 */
export function useConsumePendingTemplate(): boolean {
    const pendingKey = useAtomValue(activeTemplateAtom)
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const posthog = usePostHogAg()
    const createAgent = useCreateAgent()

    const startedRef = useRef(false)
    const [holding, setHolding] = useState<boolean>(() => Boolean(pendingKey))

    useEffect(() => {
        if (!pendingKey) {
            setHolding(false)
            return
        }

        const template = resolveTemplate(pendingKey)
        if (!template) {
            // Unknown or stale key: ignore, clear, and never fall back to another template.
            captureFirstAgentIntent(posthog, {
                source: "website_template",
                properties: {templateId: pendingKey, outcome: "invalid"},
            })
            clearTemplate()
            setHolding(false)
            return
        }

        setHolding(true)

        // Do not create until the workspace and project are real; the effect re-runs when they
        // resolve. This surface only renders on a project-scoped route, so both are present here.
        if (!workspaceId || !projectId) return
        if (startedRef.current) return
        startedRef.current = true

        void (async () => {
            const won = await claimTemplate(pendingKey)
            if (!won) {
                // Another tab won the claim; release so this surface renders normally.
                setHolding(false)
                return
            }

            captureFirstAgentIntent(posthog, {
                source: "website_template",
                properties: {
                    templateId: template.key,
                    template: template.name,
                    templateCategory: template.category,
                    outcome: "claimed",
                },
                intentValue: template.category || template.name,
            })

            try {
                await createAgent({
                    name: template.name,
                    seedMessage: template.seedMessage,
                    autoSendSeed: false,
                })
                captureFirstAgentIntent(posthog, {
                    source: "website_template",
                    properties: {templateId: template.key, outcome: "created"},
                })
            } catch {
                captureFirstAgentIntent(posthog, {
                    source: "website_template",
                    properties: {templateId: template.key, outcome: "failed"},
                })
            } finally {
                // Clear the pending key; createAgent has navigated to the new agent's playground.
                clearTemplate()
            }
        })()
    }, [pendingKey, workspaceId, projectId, posthog, createAgent])

    return holding
}
