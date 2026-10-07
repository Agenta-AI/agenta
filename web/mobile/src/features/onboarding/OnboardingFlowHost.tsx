import {useEffect, useMemo, useRef, useState} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {
    agentIconAtomFamily,
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
    refetchAgentTemplatesAtom,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {isToolsEnabled} from "@agenta/shared/api/env"
import {loadAgentIconCatalog} from "@agenta/ui/agent-icon"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import {useRouter} from "next/router"

import {capture} from "@/features/analytics/client"

import {useNewAgentAction} from "../agents/useNewAgentAction"

import type {OnboardingCatalog} from "./onboardingChoices"
import {connectedApps} from "./onboardingApps"
import {onboardingConfiguration, readInstructionsBlock} from "./onboardingConfig"
import {onboardingDraftKey, type OnboardingDraft, type OnboardingIconPick} from "./onboardingDraft"
import {OnboardingFlow, type OnboardingCreateInput} from "./OnboardingFlow"
import {endOnboarding, isOnboardingPending} from "./onboardingPending"
import {onboardingStepNumber, type OnboardingStep} from "./onboardingRoute"
import {useOnboardingModel} from "./useOnboardingModel"
import {useSeedToolConnections} from "./useSeedToolConnections"

/** Answers become person properties only once given, so an empty one never overwrites. */
const personProperties = ({role, source}: OnboardingDraft) => ({
    ...(role ? {user_role_v2: role} : {}),
    ...(source ? {referral_source_v2: source} : {}),
})

/** Wires the flow to the draft agent, the catalog, analytics, and the shared create path. */
export const OnboardingFlowHost = ({
    base,
    projectId,
    entityId,
    userId,
    homeUrl,
}: {
    base: string
    projectId: string
    /** The local draft agent the flow configures and Create commits. */
    entityId: string
    userId: string | null
    /** Where Skip leads. */
    homeUrl: string
}) => {
    // Without a pending mark the page is a preview: no analytics and no tool seeding.
    const [preview] = useState(() => !userId || !isOnboardingPending(userId))
    const router = useRouter()
    const templates = useAtomValue(agentTemplatesAtom)
    const templatesStatus = useAtomValue(agentTemplatesStatusAtom)
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const catalog = useMemo<OnboardingCatalog>(
        () => ({templates, status: templatesStatus, retry: () => refetchTemplates()}),
        [templates, templatesStatus, refetchTemplates],
    )
    const model = useOnboardingModel(entityId, projectId)
    const configuration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const toolsEnabled = useMemo(() => isToolsEnabled(), [])
    const connectionsQuery = useToolConnectionsQuery()
    const {connections} = connectionsQuery
    const apps = useMemo(() => connectedApps(connections), [connections])
    // The instructions the draft was minted with; each Create writes over these, never a retry's.
    const baseInstructionsRef = useRef<{value: unknown} | null>(null)
    if (!baseInstructionsRef.current && configuration) {
        baseInstructionsRef.current = {value: readInstructionsBlock(configuration)}
    }
    useSeedToolConnections({
        enabled: toolsEnabled && !preview,
        connections,
        loaded: !connectionsQuery.isLoading && !connectionsQuery.error,
    })
    const newAgent = useNewAgentAction(base)
    const store = useStore()
    const draftKey = onboardingDraftKey(userId ?? "anonymous")
    const finish = () => {
        if (userId) endOnboarding(userId)
    }
    const track = (event: string, properties?: Record<string, unknown>) => {
        if (!preview) capture(event, properties)
    }

    const startedRef = useRef(false)
    useEffect(() => {
        if (preview || startedRef.current) return
        startedRef.current = true
        capture("onboarding_started")
    }, [preview])

    const applyIcon = async (appId: string, pick: OnboardingIconPick) => {
        const glyph = (await loadAgentIconCatalog()).find((item) => item.name === pick.icon)
        if (glyph) {
            await store.set(agentIconAtomFamily(appId), {
                icon: glyph.name,
                color: pick.color,
                path: glyph.path,
            })
        }
    }

    const onStepCompleted = (step: OnboardingStep, draft: OnboardingDraft) =>
        track("onboarding_step_completed", {
            step: onboardingStepNumber(step),
            step_key: step,
            $set: personProperties(draft),
        })

    const onCreate = ({
        name,
        instructions,
        firstMessage,
        icon,
        apps: chosenApps,
        templateKey,
    }: OnboardingCreateInput) => {
        updateConfiguration(
            entityId,
            onboardingConfiguration(configuration ?? {}, {
                instructions,
                baseInstructions: baseInstructionsRef.current?.value,
                apps: chosenApps,
                connections,
            }),
        )
        track("onboarding_create_clicked")
        // A template's package brings its own name, instructions, tools, trigger and model; the
        // tools already on the draft stay, and an empty first message gets the template's own.
        void newAgent.createFromPrompt({
            text: firstMessage,
            name,
            entityId,
            templateKey: templateKey ?? undefined,
            onCreated: (agent) => {
                finish()
                track("onboarding_agent_created", {revision_id: agent.revisionId})
                void applyIcon(agent.appId, icon).catch(() => undefined)
            },
        })
    }

    const onSkip = (step: OnboardingStep) => {
        if (!preview) {
            capture("onboarding_skipped", {step: onboardingStepNumber(step), step_key: step})
            finish()
        }
        void router.replace(homeUrl)
    }

    return (
        <OnboardingFlow
            onboardingPath={`${base}/onboarding`}
            draftKey={draftKey}
            catalog={catalog}
            model={model}
            connectedApps={apps}
            toolsEnabled={toolsEnabled}
            creating={newAgent.creating}
            error={newAgent.error}
            onStepCompleted={onStepCompleted}
            onCreate={onCreate}
            onSkip={onSkip}
        />
    )
}
