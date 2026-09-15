import {useEffect, useMemo, useRef, useState} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    readHarnessKind,
    readModelId,
    readModelConnectionSlug,
    withHarnessKind,
    withModel,
} from "@agenta/entity-ui/drill-in"
import {
    ProviderDrawer,
    SubscriptionConnectionCard,
    providerIconFor,
} from "@agenta/entity-ui/secretProvider"
import {ArrowSquareOut, Check, Coins} from "@phosphor-icons/react"
import {App, Button, Modal, Spin} from "antd"
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

const BYOM_ICON_KEYS = ["openai", "anthropic", "gemini", "openrouter"]
const OpenAIIcon = providerIconFor("openai")
const AnthropicIcon = providerIconFor("anthropic")

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
    const managedCandidate = candidates.candidates.find((item) => item.managed)
    const codexCandidate = candidates.candidates.find((item) => item.harness === "codex")
    const chatgptConnection = candidates.connections.find((item) => item.subscription) ?? null
    const chatgptReady = chatgptConnection?.subscription?.loginState === "ready"
    const keyConnections = candidates.connections.filter((item) => !item.subscription)
    const [chatgptOpen, setChatgptOpen] = useState(false)

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

    // The design has no model picker: credits run the agent by default, a connected
    // ChatGPT takes over, and a saved key is the fallback. Selection is automatic.
    const select = (candidate: (typeof candidates.candidates)[number]) => {
        const next = withModel(withHarnessKind(configuration, candidate.harness), candidate)
        if (next) updateConfiguration(context.ephemeralId, next)
    }
    const selectRef = useRef(select)
    selectRef.current = select
    useEffect(() => {
        if (candidates.status !== "ready" || selectedModel) return
        const preferred = managedCandidate ?? codexCandidate ?? candidates.candidates[0]
        if (preferred) selectRef.current(preferred)
    }, [candidates.status, selectedModel, managedCandidate, codexCandidate, candidates.candidates])

    // A sign-in that lands while the dialog is open switches the agent to ChatGPT.
    const wasReady = useRef(chatgptReady)
    useEffect(() => {
        if (chatgptReady && !wasReady.current && codexCandidate) {
            selectRef.current(codexCandidate)
            if (chatgptOpen) {
                setChatgptOpen(false)
                message.success("ChatGPT connected. Your agent will run on it.")
            }
        }
        wasReady.current = chatgptReady
    }, [chatgptReady, codexCandidate, chatgptOpen, message])

    if (context.realEntityId) return null
    if (!variant)
        return (
            <div role="status" className="flex h-full items-center justify-center">
                <Spin /> <span className="ml-3">Preparing your workspace</span>
            </div>
        )
    const modelReady = candidates.status === "ready" && !!selectedModel
    const usingChatgpt = selectedModel?.harness === "codex"
    const rowClass =
        "flex items-center justify-between gap-4 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer p-4"
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
                        : usingChatgpt
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
                            {managedCandidate
                                ? "You're set with Agenta credits"
                                : "Choose how to run your agent"}
                        </h1>
                        <p className="mb-8 text-center text-[15px] text-colorTextSecondary">
                            {managedCandidate
                                ? "Use them to try the platform — no card needed."
                                : "Bring your subscription, or connect a model provider."}
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
                        {managedCandidate && (
                            <div className="flex items-center gap-4 rounded-xl bg-colorFillQuaternary p-4">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]">
                                    <Coins size={20} weight="fill" />
                                </span>
                                <span>
                                    <strong className="block">
                                        Agenta credits added to your account
                                    </strong>
                                    <span className="text-sm text-colorTextSecondary">
                                        Enough to try your first agent. Top up later, or bring your
                                        own.
                                    </span>
                                </span>
                            </div>
                        )}
                        {candidates.status === "ready" && !candidates.candidates.length && (
                            <p>Connect ChatGPT or add a provider key to run your first agent.</p>
                        )}
                        <p className="mb-3 mt-8 text-sm font-medium">
                            Have a subscription? Use it instead{" "}
                            <span className="font-normal text-colorTextSecondary">(optional)</span>
                        </p>
                        <div className="flex flex-col gap-3">
                            <div className={rowClass}>
                                <span className="flex items-center gap-3">
                                    <OpenAIIcon className="size-7 shrink-0" />
                                    <span>
                                        <strong className="block">ChatGPT</strong>
                                        <span className="text-xs text-colorTextSecondary">
                                            Plus · Pro · Team — runs on the Codex harness
                                        </span>
                                    </span>
                                </span>
                                {chatgptReady ? (
                                    <span className="flex items-center gap-1.5 text-colorSuccess">
                                        <Check size={14} /> Connected
                                    </span>
                                ) : (
                                    <Button onClick={() => setChatgptOpen(true)}>Connect</Button>
                                )}
                            </div>
                            <div className={rowClass}>
                                <span className="flex items-center gap-3 text-colorTextSecondary">
                                    <AnthropicIcon className="size-7 shrink-0" />
                                    <span>
                                        <span className="flex items-center gap-2">
                                            <strong className="text-colorTextSecondary">
                                                Claude
                                            </strong>
                                            <span className="rounded bg-colorFillTertiary px-1.5 py-0.5 text-[11px]">
                                                Self-hosting only
                                            </span>
                                        </span>
                                        <span className="block text-xs">
                                            Pro · Max · Team — runs on Claude Code
                                        </span>
                                    </span>
                                </span>
                                <a
                                    className="flex shrink-0 items-center gap-1"
                                    href="https://docs.agenta.ai/self-host/quick-start"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Docs <ArrowSquareOut size={12} />
                                </a>
                            </div>
                            <div className={rowClass}>
                                <span className="flex items-center gap-3">
                                    <span className="flex shrink-0 items-center">
                                        {BYOM_ICON_KEYS.map((key) => {
                                            const Icon = providerIconFor(key)
                                            return (
                                                <span
                                                    key={key}
                                                    className="-ml-1.5 flex size-6 items-center justify-center rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer first:ml-0"
                                                >
                                                    <Icon className="size-3.5" />
                                                </span>
                                            )
                                        })}
                                    </span>
                                    <span>
                                        <strong className="block">Bring your own model</strong>
                                        <span className="text-xs text-colorTextSecondary">
                                            {keyConnections.length
                                                ? `Using ${keyConnections[0].name}${keyConnections.length > 1 ? ` and ${keyConnections.length - 1} more` : ""}`
                                                : "OpenAI, Anthropic, Gemini, Ollama, OpenRouter and more"}
                                        </span>
                                    </span>
                                </span>
                                <Button onClick={setup.openDrawer}>Add API key</Button>
                            </div>
                        </div>
                    </div>
                }
            />
            <Modal
                open={chatgptOpen}
                onCancel={() => setChatgptOpen(false)}
                footer={null}
                title="Connect ChatGPT"
                destroyOnClose
            >
                <p className="mb-4 text-colorTextSecondary">
                    Sign in with your ChatGPT subscription. Your agent runs on it through the Codex
                    harness.
                </p>
                <SubscriptionConnectionCard
                    provider="chatgpt"
                    connection={chatgptConnection}
                    autoStart
                />
            </Modal>
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
