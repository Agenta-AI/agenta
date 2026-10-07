import {useEffect, useMemo, useRef} from "react"

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

import {capture} from "@/features/analytics/client"

import {useNewAgentAction} from "../agents/useNewAgentAction"

import type {OnboardingCatalog} from "./onboardingChoices"
import {onboardingConfiguration} from "./onboardingConfig"
import {
    onboardingDraftKey,
    onboardingStepNumber,
    saveOnboardingDraft,
    type OnboardingDraft,
    type OnboardingIconPick,
    type OnboardingStep,
} from "./onboardingDraft"
import {OnboardingFlow, type OnboardingCreateInput} from "./OnboardingFlow"
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
    preview,
}: {
    base: string
    projectId: string
    /** The local draft agent the flow configures and Create commits. */
    entityId: string
    /** A `?onboarding-preview` visit: no analytics and no tool seeding until Create. */
    preview: boolean
}) => {
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
    useSeedToolConnections({
        enabled: toolsEnabled && !preview,
        connections,
        loaded: !connectionsQuery.isLoading && !connectionsQuery.error,
    })
    const newAgent = useNewAgentAction(base)
    const store = useStore()
    const draftKey = onboardingDraftKey(projectId)
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

    const onCreate = ({name, instructions, firstMessage, icon, apps}: OnboardingCreateInput) => {
        updateConfiguration(
            entityId,
            onboardingConfiguration(configuration ?? {}, {instructions, apps, connections}),
        )
        track("onboarding_create_clicked")
        void newAgent.createFromPrompt({
            text: firstMessage,
            name,
            entityId,
            onCreated: (agent) => {
                saveOnboardingDraft(draftKey, null)
                track("onboarding_agent_created", {revision_id: agent.revisionId})
                void applyIcon(agent.appId, icon).catch(() => undefined)
            },
        })
    }

    return (
        <OnboardingFlow
            draftKey={draftKey}
            catalog={catalog}
            model={model}
            toolsEnabled={toolsEnabled}
            creating={newAgent.creating}
            error={newAgent.error}
            onStepCompleted={onStepCompleted}
            onCreate={onCreate}
        />
    )
}
