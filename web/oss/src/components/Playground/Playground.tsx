import {type FC, useCallback, useEffect, useMemo} from "react"

import {executeToolCall} from "@agenta/entities/gatewayTool"
import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {CatalogDrawer} from "@agenta/entity-ui/gatewayTool"
import {GatewayToolAssistantActions, type PlaygroundUIProviders} from "@agenta/playground-ui"
import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"
import {preloadEditorPlugins, SyncStateTag} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    AgentChatScopeProvider,
    ONBOARDING_SCOPE_KEY,
} from "@/oss/components/AgentChatSlice/state/scope"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {OnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
import OnboardingLoader from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingLoader"
import {useAgentOnboarding} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/useAgentOnboarding"
import {SessionInspectorDrawer} from "@/oss/components/SessionInspector"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {playgroundSyncAtom} from "@/oss/state/url/playground"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import {OSSPlaygroundShell} from "./OSSPlaygroundShell"
import PlaygroundOnboarding from "./PlaygroundOnboarding"

// Agent-chat surface (third generation arm). Lazy — only loads the AI SDK when an
// agent workflow is opened in the playground.
const AgentChatPanel = dynamic(() => import("@/oss/components/AgentChatSlice/AgentChatPanel"), {
    ssr: false,
})

/**
 * Sync state tag slot — renders the sync state badge in each row header.
 * Shown only when connected to an API-backed testset.
 * - "new" (green): row was added locally and is not yet in the connected testset
 * - "modified" (blue): row has local edits not yet synced; shows discard × on hover
 * - "unmodified": no changes — nothing rendered
 */
// TODO: This should not live here, it should be in the separate component
function PlaygroundSyncStateTag({rowId, loadableId}: {rowId: string; loadableId: string}) {
    const mode = useAtomValue(loadableController.selectors.mode(loadableId)) as
        | "local"
        | "connected"
        | null
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(rowId), [rowId])) as boolean
    const discard = useSetAtom(testcaseMolecule.actions.discard)

    const handleDiscard = useCallback(() => discard(rowId), [discard, rowId])

    // Only show sync tags when connected to an API-backed testset
    if (mode !== "connected") return null

    // New IDs are prefixed with "new-" or "local-" (established convention in the codebase)
    const isNew = rowId.startsWith("new-") || rowId.startsWith("local-")
    const syncState = isNew ? "new" : isDirty ? "modified" : "unmodified"

    return (
        <SyncStateTag
            syncState={syncState}
            dismissible={syncState === "modified"}
            onDismiss={syncState === "modified" ? handleDiscard : undefined}
        />
    )
}

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

    // Preload lazy editor plugins ASAP to reduce first-render editor suspense jank.
    useEffect(() => {
        void preloadEditorPlugins()
    }, [])

    // Onboarding only: while the ephemeral agent is still minting (an async `inspectWorkflow` round-trip
    // in the factory), show a loading shell instead of the generic 50/50 layout — otherwise the panels
    // flash the wrong split before the agent flag resolves and switches to the agent layout. Gated on
    // `onboarding` so the normal playground never hits this branch.
    if (onboarding && !agentOnboarding.ready) {
        return <OnboardingLoader />
    }

    const providers = {
        SimpleSharedEditor,
        SharedGenerationResultUtils,
        ChatTurnAssistantActions: (props) => (
            <GatewayToolAssistantActions {...props} onExecuteToolCall={executeToolCall} />
        ),
        // Third generation arm: agent-type entities render the agent-chat surface.
        // Lazy — pulls in the AI SDK only when an agent workflow is open. While onboarding, this is
        // the onboarding composer that hands off to the live chat once the ephemeral is committed.
        AgentGenerationPanel: agentOnboarding.agentPanel ?? AgentChatPanel,
        renderSyncStateTag: PlaygroundSyncStateTag,
    } as unknown as PlaygroundUIProviders

    const content = (
        <OSSPlaygroundShell providers={providers}>
            <div className="flex flex-col w-full h-[calc(100dvh-46px)] overflow-hidden">
                <PlaygroundOnboarding />
                <PlaygroundHeader key={`${uri}-header`} />
                <PlaygroundMainView
                    key={`${uri}-main`}
                    renderConfigOverride={agentOnboarding.renderConfigOverride}
                />
                <CatalogDrawer />
                <SessionInspectorDrawer />
            </div>
        </OSSPlaygroundShell>
    )

    // While onboarding, wrap so the injected onboarding panels can read the ephemeral→real transition,
    // and scope the agent-chat state to a dedicated key. The onboarding runs on the app-less project
    // route, whose default chat scope is the shared `__global__` bucket — isolating it here (paired with
    // the reset in `useAgentOnboarding`) keeps a prior visit's persisted session from being restored.
    return agentOnboarding.contextValue ? (
        <OnboardingContext.Provider value={agentOnboarding.contextValue}>
            <AgentChatScopeProvider scopeKey={ONBOARDING_SCOPE_KEY}>
                {content}
            </AgentChatScopeProvider>
        </OnboardingContext.Provider>
    ) : (
        content
    )
}

export default Playground
