import {useEffect, useRef, useState} from "react"

import {isConnectionActive, useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {
    agentTemplateLookupAtomFamily,
    detectAccounts,
    setupStepNeeded,
    templateBuilderMessage,
    UNAVAILABLE_TEMPLATE_MESSAGE,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {captureFirstAgentIntent} from "@agenta/shared/analytics"
import {App} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {urlAtom} from "@/oss/state/url"
import {
    activeTemplateAtom,
    claimTemplate,
    clearTemplate,
    completeTemplateClaim,
    pendingTemplateDecision,
} from "@/oss/state/url/template"

import {useCreateAgent} from "./useCreateAgent"

/** Same gate as the in-app setup step: does this template need accounts connected first? */
export const templateNeedsSetup = (
    template: AgentStarterTemplate,
    connectedSlugs: string[],
): boolean =>
    setupStepNeeded({
        accounts: detectAccounts({description: templateBuilderMessage(template), template}),
        connectedSlugs,
        forTemplate: true,
    })

/**
 * Consume a pending website template at whichever first-run surface the user reaches. A new user
 * lands on the native onboarding playground and a returning user on the agent home page, so this
 * hook is mounted above both and consumes the key wherever the user actually is.
 *
 * Returns `true` while a valid template is being consumed, so the caller can hold the onboarding
 * loader instead of flashing the normal surface (which would fire its own redirect and race this).
 *
 * The steps mirror the plan's consume requirements: validate the key by exact catalog lookup
 * (an unknown or stale key is ignored and cleared, never creating an agent); wait for a confirmed
 * workspace and project; claim the key so it fires at most once. A template with accounts to
 * connect then opens the create surface with its setup step (`?new=1&template=`), exactly as an
 * in-app pick does; otherwise the agent is created by loading the package, never a blank agent.
 *
 * The catalog comes from the API, so the lookup can be unresolved. While it loads, the key is kept
 * and the loader held. If the read fails, the key is still kept (a failed read says nothing about
 * the key) but the loader is released, so the user is not stuck on a skeleton; the key is consumed
 * once a later catalog read succeeds. Only a catalog that loaded without the key clears it.
 */
export function useConsumePendingTemplate(): boolean {
    const pending = useAtomValue(activeTemplateAtom)
    const pendingKey = pending?.key
    const capturedAt = pending?.capturedAt
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const posthog = usePostHogAg()
    const {message} = App.useApp()
    const router = useRouter()
    const {baseAppURL} = useAtomValue(urlAtom)
    const {connections, isLoading: connectionsLoading} = useToolConnectionsQuery()
    const createAgent = useCreateAgent()
    const lookup = useAtomValue(agentTemplateLookupAtomFamily(pendingKey ?? ""))

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
        const decision = pendingTemplateDecision(lookup)
        if (decision.action === "wait") {
            // Keep the key; never create or clear on an unresolved lookup.
            setHolding(decision.reason === "pending")
            return
        }
        if (decision.action === "discard") {
            captureFirstAgentIntent(posthog, {
                source: "website_template",
                properties: {templateId: pendingKey, outcome: "invalid"},
            })
            message.warning(UNAVAILABLE_TEMPLATE_MESSAGE)
            clearTemplate(pendingGeneration)
            setHolding(false)
            return
        }

        const {template} = decision
        setHolding(true)

        // Do not create until the workspace and project are real; the effect re-runs when they
        // resolve. Scope the latch to this capture generation so a later template can proceed
        // while the same page component remains mounted.
        if (!workspaceId || !projectId || !baseAppURL || connectionsLoading) return
        if (startedRef.current === generationId) return
        startedRef.current = generationId

        void (async () => {
            const won = await claimTemplate(pendingGeneration)
            if (!won) {
                // The generation was already claimed, so its agent exists (or is being created by
                // the winner). Drop the key rather than leaving it stored to re-arm this hook — and
                // flash the onboarding loader — on every later page.
                clearTemplate(pendingGeneration)
                // Only drop the loader if this generation is still the current one — a later
                // capture may have re-armed it while this claim was in flight.
                if (startedRef.current === generationId) {
                    startedRef.current = null
                    setHolding(false)
                }
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

            const connectedSlugs = connections
                .filter(isConnectionActive)
                .map((connection) => connection.integration_key)
                .filter(Boolean) as string[]
            if (templateNeedsSetup(template, connectedSlugs)) {
                captureFirstAgentIntent(posthog, {
                    source: "website_template",
                    properties: {templateId: template.key, outcome: "setup"},
                })
                await completeTemplateClaim(pendingGeneration)
                clearTemplate(pendingGeneration)
                if (startedRef.current === generationId) startedRef.current = null
                void router.replace(
                    `${baseAppURL}?new=1&template=${encodeURIComponent(template.key)}`,
                )
                return
            }

            try {
                // Load the real package, the same path as an in-app template pick. The setup is
                // what the skipped step would have passed, so the connected accounts get bound.
                const created = await createAgent({
                    name: template.name,
                    template,
                    setup: {
                        accounts: detectAccounts({
                            description: templateBuilderMessage(template),
                            template,
                        }),
                        connectedSlugs,
                    },
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
    }, [
        pendingKey,
        capturedAt,
        lookup,
        workspaceId,
        projectId,
        baseAppURL,
        connections,
        connectionsLoading,
        router,
        posthog,
        createAgent,
        message,
    ])

    return holding
}
