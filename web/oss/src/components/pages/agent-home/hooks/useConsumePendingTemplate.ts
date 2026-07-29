import {useEffect, useRef, useState} from "react"

import {useAtomValue} from "jotai"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {
    activeTemplateAtom,
    claimTemplate,
    clearTemplate,
    completeTemplateClaim,
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
    const pending = useAtomValue(activeTemplateAtom)
    const pendingKey = pending?.key
    const capturedAt = pending?.capturedAt
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const posthog = usePostHogAg()
    const createAgent = useCreateAgent()

    const startedRef = useRef<string | null>(null)
    const [holding, setHolding] = useState<boolean>(() => Boolean(pending))

    useEffect(() => {
        if (!pendingKey || capturedAt === undefined) {
            startedRef.current = null
            setHolding(false)
            return
        }

        const pendingGeneration = {key: pendingKey, capturedAt}
        const generationId = pendingKey + ":" + capturedAt
        const template = resolveTemplate(pendingKey)
        if (!template) {
            captureFirstAgentIntent(posthog, {
                source: "website_template",
                properties: {templateId: pendingKey, outcome: "invalid"},
            })
            clearTemplate(pendingGeneration)
            setHolding(false)
            return
        }

        setHolding(true)

        // Do not create until the workspace and project are real; the effect re-runs when they
        // resolve. Scope the latch to this capture generation so a later template can proceed
        // while the same page component remains mounted.
        if (!workspaceId || !projectId) return
        if (startedRef.current === generationId) return
        startedRef.current = generationId

        void (async () => {
            const won = await claimTemplate(pendingGeneration)
            if (!won) {
                if (startedRef.current === generationId) startedRef.current = null
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
                const created = await createAgent({
                    name: template.name,
                    seedMessage: template.seedMessage,
                    autoSendSeed: false,
                })
                captureFirstAgentIntent(posthog, {
                    source: "website_template",
                    properties: {
                        templateId: template.key,
                        outcome: created ? "created" : "failed",
                    },
                })
            } catch {
                captureFirstAgentIntent(posthog, {
                    source: "website_template",
                    properties: {templateId: template.key, outcome: "failed"},
                })
            } finally {
                await completeTemplateClaim(pendingGeneration)
                clearTemplate(pendingGeneration)
                if (startedRef.current === generationId) startedRef.current = null
            }
        })()
    }, [pendingKey, capturedAt, workspaceId, projectId, posthog, createAgent])

    return holding
}
