import {useEffect, useMemo, useRef, useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {
    agentIconAtomFamily,
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
    refetchAgentTemplatesAtom,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {isWalletsEnabled} from "@agenta/shared/api/env"
import {loadAgentIconCatalog} from "@agenta/ui/agent-icon"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {capture} from "@/features/analytics/client"
import {newId} from "@/lib/ids"

import {useNewAgentAction} from "../agents/useNewAgentAction"

import {connectedApps} from "./onboardingApps"
import type {OnboardingCatalog} from "./onboardingChoices"
import {draftConfigurationAtom, onboardingConfiguration} from "./onboardingConfig"
import {
    onboardingDraftKey,
    type FirstAgentInput,
    type OnboardingDraft,
    type OnboardingIconPick,
} from "./onboardingDraft"
import {OnboardingFlow} from "./OnboardingFlow"
import {endOnboarding, isOnboardingPending} from "./onboardingPending"
import {personProperties} from "./onboardingQuestions"
import {onboardingSteps, stepIndex, type OnboardingStep} from "./onboardingRoute"
import {useOnboardingModel} from "./useOnboardingModel"

/** Wires the flow to the draft agent, the catalog, analytics, and the shared create path. */
export const OnboardingFlowHost = ({
    base,
    projectId,
    entityId,
    userId,
}: {
    base: string
    projectId: string
    /** The local draft agent Create commits; `null` while it is still being minted. */
    entityId: string | null
    userId: string | null
}) => {
    // Without a pending mark the page is a preview: no analytics.
    const [preview] = useState(() => !userId || !isOnboardingPending(userId))
    const templates = useAtomValue(agentTemplatesAtom)
    const templatesStatus = useAtomValue(agentTemplatesStatusAtom)
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const catalog = useMemo<OnboardingCatalog>(
        () => ({templates, status: templatesStatus, retry: () => refetchTemplates()}),
        [templates, templatesStatus, refetchTemplates],
    )
    const autoModel = useOnboardingModel(entityId, projectId)
    // The wallet is behind its own flag; without it the credits step offers only a plan or a key.
    const walletsEnabled = useMemo(() => isWalletsEnabled(), [])
    const model = useMemo(
        () => (walletsEnabled ? autoModel : {...autoModel, credits: null}),
        [walletsEnabled, autoModel],
    )
    const steps = useMemo(() => onboardingSteps(), [])
    const configuration = useAtomValue(useMemo(() => draftConfigurationAtom(entityId), [entityId]))
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const {connections} = useToolConnectionsQuery()
    const apps = useMemo(() => connectedApps(connections), [connections])
    const newAgent = useNewAgentAction(base)
    // Files stage against a session id before the agent exists, as on Home.
    const [sessionId] = useState(newId)
    const attachments = useComposerAttachments({sessionId})
    const store = useStore()
    const draftKey = onboardingDraftKey(userId ?? "anonymous")
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
            step: stepIndex(step) + 1,
            step_key: step,
            $set: personProperties(draft.answers),
        })

    const onCreate = async ({
        name,
        firstMessage,
        icon,
        apps: chosenApps,
        templateKey,
    }: FirstAgentInput) => {
        if (!entityId) return false
        updateConfiguration(
            entityId,
            onboardingConfiguration(configuration ?? {}, {apps: chosenApps, connections}),
        )
        track("onboarding_create_clicked")
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        // Cleared before the hand-off: the chat route seeds its tray from this session's store.
        attachments.clearAttachments(staged.map((file) => file.uid))
        // A template's package sets its own name, instructions, tools, trigger and model.
        const created = await newAgent.createFromPrompt({
            text: firstMessage,
            name,
            entityId,
            templateKey: templateKey ?? undefined,
            sessionId,
            parts,
            onCreated: (agent) => {
                if (userId) endOnboarding(userId)
                track("onboarding_agent_created", {revision_id: agent.revisionId})
                void applyIcon(agent.appId, icon).catch(() => undefined)
            },
        })
        if (!created) attachments.restoreAttachments(staged)
        return created
    }

    return (
        <OnboardingFlow
            onboardingPath={`${base}/onboarding`}
            draftKey={draftKey}
            steps={steps}
            catalog={catalog}
            model={model}
            connectedApps={apps}
            creating={newAgent.creating}
            error={newAgent.error}
            attachments={attachments}
            onStepCompleted={onStepCompleted}
            onCreate={onCreate}
        />
    )
}
