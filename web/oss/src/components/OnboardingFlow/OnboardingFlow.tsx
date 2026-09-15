import {useEffect, useMemo, useRef} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
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
import {App, Button, Spin} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useOnboardingProviderSetup} from "@/oss/components/AgentChatSlice/hooks/useOnboardingProviderSetup"
import {useOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
import {projectIdAtom} from "@/oss/state/project"

import AgentIdentity from "./AgentIdentity"
import ConnectToolsStep from "./ConnectToolsStep"
import {onboardingDraftKey, saveOnboardingDraft} from "./draft"
import OnboardingFlowView from "./OnboardingFlowView"
import {withOnboardingTools} from "./tools"
import {useOnboardingExperiment} from "./useOnboardingExperiment"

export default function OnboardingFlow() {
    const {message} = App.useApp()
    const {connections: toolConnections} = useToolConnectionsQuery()
    const context = useOnboardingContext()
    const projectId = useAtomValue(projectIdAtom)
    const draftKey = projectId ? onboardingDraftKey(projectId) : undefined
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
        saveOnboardingDraft(draftKey, null)
        if (enrolled)
            posthog?.capture("onboarding_agent_created", {
                variant,
                revision_id: context.realEntityId,
            })
    }, [context.realEntityId, posthog, variant, enrolled, draftKey])
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
                key={draftKey}
                draftKey={draftKey}
                identity={<AgentIdentity entityId={context.ephemeralId} />}
                variant={variant}
                committing={context.committing}
                modelReady={modelReady}
                modelNextLabel={
                    selectedModel?.managed
                        ? "Continue with credits"
                        : selectedModel?.harness === "codex"
                          ? "Continue with ChatGPT"
                          : "Continue with your key"
                }
                onCreate={({name, seedMessage, connectionIds = []}) => {
                    try {
                        updateConfiguration(
                            context.ephemeralId,
                            withOnboardingTools(
                                configuration ?? {},
                                toolConnections,
                                connectionIds,
                            ),
                        )
                    } catch (error) {
                        message.error(
                            error instanceof Error ? error.message : "Couldn't add your apps.",
                        )
                        return
                    }
                    if (enrolled) posthog?.capture("onboarding_create_clicked", {variant})
                    context.commit(seedMessage, name)
                }}
                onStep={(step, answers) =>
                    posthog?.capture("onboarding_step_completed", {
                        ...(enrolled ? {variant} : {}),
                        step,
                        $set: {user_role_v2: answers.role, referral_source_v2: answers.source},
                    })
                }
                tools={(selectedIds, onChange) => (
                    <ConnectToolsStep selectedIds={selectedIds} onChange={onChange} />
                )}
                model={
                    <div>
                        <h1 className="mb-2 text-center text-[30px] font-semibold">
                            {availableConnections.some((item) => item.managed)
                                ? "You're set with Agenta credits"
                                : "Choose how to run your agent"}
                        </h1>
                        <p className="mb-8 text-center text-[15px] text-colorTextSecondary">
                            Use available credits, or bring your own subscription or model.
                        </p>
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
                        <p className="mb-3 mt-7 text-sm text-colorTextSecondary">
                            Have a subscription? Use it instead (optional)
                        </p>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-solid border-colorBorderSecondary p-4">
                                <span>
                                    <strong className="block">ChatGPT</strong>
                                    <span className="text-xs text-colorTextSecondary">
                                        Plus · Pro · Team
                                    </span>
                                </span>
                                <Button onClick={setup.openDrawer}>Connect</Button>
                            </div>
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-solid border-colorBorderSecondary p-4 text-colorTextSecondary">
                                <span>
                                    <strong className="block">Claude</strong>
                                    <span className="text-xs">
                                        Pro · Max · Team · Self-hosting only
                                    </span>
                                </span>
                                <a
                                    href="https://docs.agenta.ai/self-host/quick-start"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Docs
                                </a>
                            </div>
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-solid border-colorBorderSecondary p-4">
                                <span>
                                    <strong className="block">Bring your own model</strong>
                                    <span className="text-xs text-colorTextSecondary">
                                        OpenAI, Anthropic, Gemini, Ollama, OpenRouter and more
                                    </span>
                                </span>
                                <Button onClick={setup.openDrawer}>Add API key</Button>
                            </div>
                        </div>
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
