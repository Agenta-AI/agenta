import {useMemo} from "react"

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
import {
    activeOnboardingSteps,
    onboardingDraftKey,
    onboardingStepNumber,
    saveOnboardingDraft,
    type OnboardingDraft,
    type OnboardingIconPick,
    type OnboardingStep,
} from "./onboardingDraft"
import {OnboardingFlow, type OnboardingCreateInput} from "./OnboardingFlow"
import {OnboardingModelStep} from "./OnboardingModelStep"
import {withOnboardingTools} from "./onboardingTools"
import {OnboardingToolsStep} from "./OnboardingToolsStep"
import type {OnboardingAssignment} from "./useOnboardingExperiment"
import {useOnboardingModel} from "./useOnboardingModel"

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
    assignment,
    preview,
}: {
    base: string
    projectId: string
    /** The local draft agent the flow configures and Create commits. */
    entityId: string
    assignment: OnboardingAssignment
    /** A `?onboarding-variant=` preview; it changes nothing in the project until Create. */
    preview: boolean
}) => {
    const {variant, enrolled} = assignment
    const templates = useAtomValue(agentTemplatesAtom)
    const templatesStatus = useAtomValue(agentTemplatesStatusAtom)
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const catalog = useMemo<OnboardingCatalog>(
        () => ({templates, status: templatesStatus, retry: () => refetchTemplates()}),
        [templates, templatesStatus, refetchTemplates],
    )
    const model = useOnboardingModel(entityId)
    const configuration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const {connections} = useToolConnectionsQuery()
    const newAgent = useNewAgentAction(base)
    const store = useStore()
    const steps = useMemo(() => activeOnboardingSteps(isToolsEnabled()), [])
    const draftKey = onboardingDraftKey(projectId)
    const experiment = enrolled ? {variant} : {}

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
        capture("onboarding_step_completed", {
            ...experiment,
            step: onboardingStepNumber(step),
            step_key: step,
            $set: personProperties(draft),
        })

    const onCreate = ({name, seedMessage, icon}: OnboardingCreateInput) => {
        updateConfiguration(entityId, withOnboardingTools(configuration ?? {}, connections))
        if (enrolled) capture("onboarding_create_clicked", {variant})
        void newAgent.createFromPrompt({
            text: seedMessage,
            name,
            entityId,
            onCreated: (agent) => {
                saveOnboardingDraft(draftKey, null)
                if (enrolled) {
                    capture("onboarding_agent_created", {variant, revision_id: agent.revisionId})
                }
                if (icon) void applyIcon(agent.appId, icon).catch(() => undefined)
            },
        })
    }

    return (
        <OnboardingFlow
            variant={variant}
            draftKey={draftKey}
            steps={steps}
            catalog={catalog}
            tools={<OnboardingToolsStep seed={!preview} />}
            model={<OnboardingModelStep model={model} />}
            modelReady={model.ready}
            modelNextLabel={model.nextLabel}
            creating={newAgent.creating}
            error={newAgent.error}
            onStepCompleted={onStepCompleted}
            onCreate={onCreate}
        />
    )
}
