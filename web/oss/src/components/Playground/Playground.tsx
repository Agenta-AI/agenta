import {type ComponentProps, type FC, useEffect} from "react"

import {executeToolCall} from "@agenta/entities/gatewayTool"
import {
    GatewayToolAssistantActions,
    type ChatTurnAssistantActionsProps,
    type PlaygroundUIProviders,
} from "@agenta/playground-ui"
import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"
import {preloadEditorPlugins} from "@agenta/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

// Synchronous thin frame (Splitter + Tabs + region slots): its real structure paints immediately;
// the heavy conversation body / bar / rail are lazy leaves inside it, each behind its own skeleton.
import AgentChatPanel from "@/oss/components/AgentChatSlice/AgentChatPanel"
import {AgentChatScopeProvider} from "@/oss/components/AgentChatSlice/state/scope"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {OnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
import OnboardingLoader from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingLoader"
import {useAgentOnboarding} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/useAgentOnboarding"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {playgroundSyncAtom} from "@/oss/state/url/playground"
import {playgroundEarlyAgentStateAtom} from "@/oss/state/workflow"

import AgentCatalogPrefetcher from "./Components/AgentCatalogPrefetcher"
import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import PlaygroundSyncStateTag from "./Components/PlaygroundSyncStateTag"
import {OSSPlaygroundShell} from "./OSSPlaygroundShell"
import PlaygroundOnboarding from "./PlaygroundOnboarding"

// Agent-chat surface (third generation arm). The host is a LIGHT static import that lazy-loads
// the AI-SDK panel internally and crossfades it in through a persistent skeleton overlay —
// components materialize in place instead of a skeleton-discard → sudden pop.

// Open-on-demand drawers: mounted closed until the user opens them, so their subtrees
// load lazily instead of riding the playground's initial chunk.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)

const Playground: FC<{onboarding?: boolean}> = ({onboarding = false}) => {
    const uri = "playground" // Static value, no need for complex data subscription

    // Show warning when user tries to leave with unsaved local drafts
    useLocalDraftWarning()

    // Mount imperative playground state sync (store.sub subscriptions)
    // This replaces the old usePlaygroundUrlSync hook with React-free subscriptions
    useAtomValue(playgroundSyncAtom)

    // Playground-native onboarding: mint + drive an ephemeral agent inside this real playground (so it
    // reuses all the machinery above). Fully inert when `onboarding` is false — normal playground path.
    const agentOnboarding = useAgentOnboarding(onboarding)

    // Once we know this is an agent playground (instant on reload via the persisted agent-type map),
    // warm the static agent catalogs in parallel with the revision/inspect waterfall — see
    // AgentCatalogPrefetcher. Onboarding is always an agent, so prefetch there too.
    const earlyAgentState = useAtomValue(playgroundEarlyAgentStateAtom)
    const prefetchAgentCatalogs = onboarding || earlyAgentState === "agent"

    // Preload lazy editor plugins ASAP to reduce first-render editor suspense jank.
    useEffect(() => {
        void preloadEditorPlugins()
    }, [])

    // Onboarding only: while the ephemeral agent is still minting (an async `inspectWorkflow` round-trip
    // in the factory), show a loading shell instead of the generic 50/50 layout — otherwise the panels
    // flash the wrong split before the agent flag resolves and switches to the agent layout. Gated on
    // `onboarding` so the normal playground never hits this branch.
    if (onboarding && !agentOnboarding.ready) {
        return <OnboardingLoader error={agentOnboarding.error} onRetry={agentOnboarding.retry} />
    }

    const providers = {
        SimpleSharedEditor,
        SharedGenerationResultUtils,
        ChatTurnAssistantActions: (props: ChatTurnAssistantActionsProps) => (
            <GatewayToolAssistantActions
                {...props}
                // Fern ToolCall/ToolCallResponse drift from the package's inline shapes; runtime payloads match — typed as-is
                onExecuteToolCall={
                    executeToolCall as unknown as ComponentProps<
                        typeof GatewayToolAssistantActions
                    >["onExecuteToolCall"]
                }
            />
        ),
        // Third generation arm: agent-type entities render the agent-chat surface. The frame is
        // synchronous (real structure paints immediately); the AI SDK stays in the lazy conversation
        // body. While onboarding, this is the onboarding composer that hands off to the live chat.
        AgentGenerationPanel: agentOnboarding.agentPanel ?? AgentChatPanel,
        renderSyncStateTag: PlaygroundSyncStateTag,
    } as unknown as PlaygroundUIProviders

    const content = (
        <OSSPlaygroundShell providers={providers}>
            <div className="flex flex-col w-full h-[calc(100dvh-46px)] overflow-hidden">
                {prefetchAgentCatalogs ? <AgentCatalogPrefetcher /> : null}
                <PlaygroundOnboarding />
                <PlaygroundHeader key={`${uri}-header`} />
                <PlaygroundMainView
                    key={`${uri}-main`}
                    renderConfigOverride={agentOnboarding.renderConfigOverride}
                />
                <CatalogDrawer />
            </div>
        </OSSPlaygroundShell>
    )

    // While onboarding, wrap so the injected onboarding panels can read the ephemeral→real transition,
    // and scope the agent-chat state to a dedicated key. The onboarding runs on the app-less project
    // route, whose default chat scope is the shared `__global__` bucket — isolating it here (paired with
    // the reset in `useAgentOnboarding`) keeps a prior visit's persisted session from being restored.
    // Once the app is committed, `chatScopeKey` flips to the app's own scope in the same update that
    // adopts the session into it — so post-commit chat state lands where the app playground reads it.
    return agentOnboarding.contextValue ? (
        <OnboardingContext.Provider value={agentOnboarding.contextValue}>
            <AgentChatScopeProvider scopeKey={agentOnboarding.chatScopeKey}>
                {content}
            </AgentChatScopeProvider>
        </OnboardingContext.Provider>
    ) : (
        content
    )
}

export default Playground
