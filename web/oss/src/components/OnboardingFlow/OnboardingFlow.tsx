import {useEffect, useMemo, useRef} from "react"

import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    modelDisplayName,
    readHarnessKind,
    readModelId,
    readModelConnectionSlug,
    withHarnessKind,
    withModel,
} from "@agenta/entity-ui/drill-in"
import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {Button, Spin} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useOnboardingProviderSetup} from "@/oss/components/AgentChatSlice/hooks/useOnboardingProviderSetup"
import {useOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"

import ConnectToolsStep from "./ConnectToolsStep"
import OnboardingFlowView from "./OnboardingFlowView"
import {useOnboardingExperiment} from "./useOnboardingExperiment"

export default function OnboardingFlow() {
    const context = useOnboardingContext()
    const candidates = useAtomValue(agentModelCandidatesAtomFamily(true))
    const configuration = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.configuration(context.ephemeralId),
            [context.ephemeralId],
        ),
    )
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const currentModel = readModelId(configuration)
    const currentHarness = readHarnessKind(configuration)
    const currentSlug = readModelConnectionSlug(configuration)
    const selectedModel = candidates.candidates.find(
        (item) =>
            item.modelId === currentModel &&
            item.harness === currentHarness &&
            item.slug === currentSlug,
    )
    const availableConnections = candidates.candidates.filter(
        (item, index, all) =>
            all.findIndex((other) => other.connectionKey === item.connectionKey) === index,
    )

    const setup = useOnboardingProviderSetup(context.ephemeralId, {gateActive: true})
    const {variant, posthog, enrolled} = useOnboardingExperiment()
    const completed = useRef(false)
    useEffect(() => {
        if (!context.realEntityId || completed.current) return
        completed.current = true
        if (enrolled)
            posthog?.capture("onboarding_agent_created", {
                variant,
                revision_id: context.realEntityId,
            })
    }, [context.realEntityId, posthog, variant, enrolled])
    if (context.realEntityId) return null
    if (!variant)
        return (
            <div role="status" className="flex h-full items-center justify-center">
                <Spin /> <span className="ml-3">Preparing your workspace</span>
            </div>
        )
    const modelReady = candidates.status === "ready" && !!selectedModel
    return (
        <>
            <OnboardingFlowView
                variant={variant}
                committing={context.committing}
                modelReady={modelReady}
                onCreate={({name, seedMessage}) => {
                    if (enrolled) posthog?.capture("onboarding_create_clicked", {variant})
                    context.commit(seedMessage, name)
                }}
                onStep={(step, answers) =>
                    posthog?.capture("onboarding_step_completed", {
                        variant,
                        step,
                        $set: {user_role_v2: answers.role, referral_source_v2: answers.source},
                    })
                }
                tools={<ConnectToolsStep />}
                model={
                    <div className="rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer p-6">
                        <h2 className="text-xl font-semibold">Your model connection</h2>
                        {candidates.status === "loading" && (
                            <p role="status">Checking available models…</p>
                        )}
                        {candidates.status === "error" && (
                            <p role="alert">
                                Couldn't check your model connections. Open the connection panel to
                                retry.
                            </p>
                        )}
                        <div className="my-5 flex flex-col gap-3">
                            {availableConnections.map((candidate) => {
                                const connection = candidates.connections.find(
                                    (item) => item.id === candidate.connectionKey,
                                )
                                const active =
                                    selectedModel?.connectionKey === candidate.connectionKey
                                return (
                                    <button
                                        key={candidate.connectionKey}
                                        type="button"
                                        aria-pressed={active}
                                        className={`rounded-xl border border-solid p-4 text-left ${active ? "border-colorText bg-colorFillTertiary" : "border-colorBorderSecondary"}`}
                                        onClick={() => {
                                            const next = withModel(
                                                withHarnessKind(configuration, candidate.harness),
                                                candidate,
                                            )
                                            if (next) updateConfiguration(context.ephemeralId, next)
                                        }}
                                    >
                                        <strong className="block">
                                            {candidate.managed
                                                ? "Agenta credits"
                                                : (connection?.name ??
                                                  (candidate.harness === "codex"
                                                      ? "ChatGPT subscription"
                                                      : "Connected subscription"))}
                                        </strong>
                                        <span className="text-sm text-colorTextSecondary">
                                            {modelDisplayName(
                                                candidates.capabilities,
                                                candidate.harness,
                                                active ? selectedModel.modelId : candidate.modelId,
                                            )}
                                            {active ? " · Selected" : ""}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                        {!modelReady && candidates.status === "ready" && (
                            <p>Connect ChatGPT or add a provider key to run your first agent.</p>
                        )}
                        <Button size="large" onClick={setup.openDrawer}>
                            Connect a model
                        </Button>
                        <p className="mt-4 text-sm text-colorTextSecondary">
                            The connection panel shows the options available in this deployment.
                            Claude subscriptions require self-hosting.
                        </p>
                    </div>
                }
            />
            <ProviderDrawer
                open={setup.open}
                onClose={setup.closeDrawer}
                context="playground"
                connections={setup.connections}
                onSaved={setup.onSaved}
            />
        </>
    )
}
