import {
    type ComponentType,
    type ReactNode,
    createElement,
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {createEphemeralAppFromTemplate} from "@agenta/entities/workflow"
import {
    hasPendingHydrationAtomFamily,
    isAgentModeAtomFamily,
    playgroundController,
} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {ONBOARDING_SCOPE_KEY} from "@/oss/components/AgentChatSlice/state/scope"
import {resetScopeAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"
import {urlAtom} from "@/oss/state/url"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {useCreateAgent} from "../hooks/useCreateAgent"

import OnboardingConfigPanel from "./OnboardingConfigPanel"
import OnboardingConfigSettling from "./OnboardingConfigSettling"
import {type OnboardingContextValue} from "./OnboardingContext"

export interface AgentOnboardingResult {
    /** True once the ephemeral has been minted (the playground can render it). */
    ready: boolean
    /** Override for the playground's `AgentGenerationPanel` (the onboarding composer → live chat). */
    agentPanel: ComponentType | null
    /** Templates for the config-panel slot while ephemeral; undefined once real. */
    renderConfigOverride: ReactNode
    /** Onboarding context to wrap the playground with; null when inactive. */
    contextValue: OnboardingContextValue | null
}

/**
 * Drives playground-native onboarding INSIDE the real `Playground` (so it reuses `playgroundSyncAtom`
 * init, the header, and all providers — a parallel mount rendered empty because it never set
 * `playgroundInitializedAtom`). When `active`, mints an ephemeral agent and registers it as the
 * playground entity; "Create agent"/a template commits it IN PLACE (no redirect) and swaps the right
 * panel to the live chat. Fully inert (no ephemeral, no overrides) when `active` is false, so the
 * normal playground is unchanged.
 */
export function useAgentOnboarding(active: boolean): AgentOnboardingResult {
    const setEntityIds = useSetAtom(playgroundController.actions.setEntityIds)
    const createAgent = useCreateAgent()
    const {baseAppURL} = useAtomValue(urlAtom)
    const resetOnboardingScope = useSetAtom(resetScopeAtomFamily(ONBOARDING_SCOPE_KEY))

    const [entityId, setEntityId] = useState<string | null>(null)
    const [realEntityId, setRealEntityId] = useState<string | null>(null)
    const [committing, setCommitting] = useState(false)
    const [committingSeed, setCommittingSeed] = useState<string | null>(null)
    const [browseAll, setBrowseAll] = useState(false)
    const [chromeRevealed, setChromeRevealed] = useState(false)
    const startedRef = useRef(false)

    // Post-commit chrome (session bar / connect-model banner / header mode switch) eases in a beat AFTER
    // the commit, so the send + transcript scroll settle first instead of everything moving at once.
    useEffect(() => {
        if (!realEntityId) {
            setChromeRevealed(false)
            return
        }
        const id = window.setTimeout(() => setChromeRevealed(true), 500)
        return () => window.clearTimeout(id)
    }, [realEntityId])

    // Mint one ephemeral agent when onboarding activates. Ref-guarded so it runs exactly once.
    // NOTE: deliberately NO abort-on-cleanup. React StrictMode double-invokes effects (setup → cleanup
    // → setup) and the ref-guard blocks the second setup, so aborting on the first cleanup would cancel
    // the ONLY mint attempt and leave entityId null forever (→ no ephemeral, no agent). The mint is
    // cheap and client-only; let it finish. The component instance survives the StrictMode cycle, so
    // setEntityId lands (and a genuine unmount mid-mint is a harmless no-op in React 18).
    useEffect(() => {
        if (!active) return
        if (startedRef.current) return
        startedRef.current = true
        // Wipe the onboarding scope BEFORE the ephemeral is minted (→ before AgentChatPanel mounts and
        // seeds its session). The onboarding runs on the app-less project route and uses a fixed scope
        // key, so a prior visit's persisted conversation (e.g. a failed run) would otherwise be restored
        // into this "fresh" session. Runs once per mount (ref-guarded above).
        resetOnboardingScope()
        void createEphemeralAppFromTemplate({
            type: "agent",
            defaultName: "New agent",
            // Return as soon as the entity is seeded (flags → agent layout resolves at once); the schema
            // inspect round-trip resolves in the background (not needed for the pre-commit surface).
            deferInspect: true,
        }).then((id) => {
            if (id) setEntityId(id)
        })
    }, [active])

    // Point the playground at the ephemeral (until it's committed to a real revision). `setEntityIds`
    // alone doesn't hold on the project route: `playgroundSyncAtom` reconciles the selection against the
    // URL's `?revisions`, so with no param it drops back to empty (→ no entity → the generic 50/50 split
    // + no agent chat). Writing the selection to the URL (the documented ephemeral pattern) keeps it
    // selected and lets the agent workflow type resolve, so `MainLayout` uses the agent layout.
    useEffect(() => {
        if (!active || !entityId || realEntityId) return
        setEntityIds([entityId])
        writePlaygroundSelectionToQuery([entityId])
    }, [active, entityId, realEntityId, setEntityIds])

    // Commit the ephemeral into a real agent IN PLACE — reuse `useCreateAgent` with our existing
    // ephemeral + an `onCommitted` callback (no redirect): swap the entity, flip to the live chat, and
    // reflect the app in the URL via `history.replaceState` (a real nav to the app route is a different
    // Next page → would remount; a reload then lands on the app playground).
    const commit = useCallback(
        (seedMessage: string, name?: string) => {
            if (!entityId || committing || realEntityId) return
            setCommitting(true)
            // Surface the seed so the chat can render it as an optimistic user turn during commit.
            setCommittingSeed(seedMessage.trim() || null)
            void createAgent({
                name,
                seedMessage,
                entityId,
                // Create-agent is an explicit "go" → the chat sends the description as the first turn
                // once the model is ready (no extra Start click), keeping the transition seamless.
                autoSendSeed: true,
                onCommitted: ({appId, revisionId}) => {
                    // Flip the onboarding state urgently — the settling skeleton, the `chromeRevealed`
                    // timer, and the commit-failure recovery all read `realEntityId` synchronously.
                    setRealEntityId(revisionId)
                    // Hand the heavy part (the playground re-rendering the real entity → config panel +
                    // generation surface) to a transition, so React can yield to the browser and the
                    // commit's CSS animations aren't starved by a blocking render.
                    startTransition(() => {
                        setEntityIds([revisionId])
                    })
                    if (typeof window !== "undefined") {
                        window.history.replaceState(
                            window.history.state,
                            "",
                            `${baseAppURL}/${appId}/playground?revisions=${revisionId}`,
                        )
                    }
                },
            }).finally(() => setCommitting(false))
        },
        [entityId, committing, realEntityId, createAgent, setEntityIds, baseAppURL],
    )

    const contextValue = useMemo<OnboardingContextValue | null>(
        () =>
            active
                ? {
                      ephemeralId: entityId ?? "",
                      realEntityId,
                      committing,
                      committingSeed,
                      commit,
                      browseAll,
                      setBrowseAll,
                      chromeRevealed,
                  }
                : null,
        [
            active,
            entityId,
            realEntityId,
            committing,
            committingSeed,
            commit,
            browseAll,
            chromeRevealed,
        ],
    )

    // After commit, the real config panel resolves its schema asynchronously — mounting it immediately
    // pops sections in one by one. Subscribe to the real entity's readiness here (which also DRIVES the
    // resolution, since these are query-backed atoms) and keep a settling placeholder in the config slot
    // until it's ready, so the real config appears in one clean pass. A timeout reveals anyway so a
    // never-flipping signal can't strand the placeholder.
    const realId = realEntityId ?? ""
    const realIsAgent = useAtomValue(useMemo(() => isAgentModeAtomFamily(realId), [realId]))
    const realPendingHydration = useAtomValue(
        useMemo(() => hasPendingHydrationAtomFamily(realId), [realId]),
    )
    const [settleTimedOut, setSettleTimedOut] = useState(false)
    useEffect(() => {
        if (!realEntityId) return
        setSettleTimedOut(false)
        const id = window.setTimeout(() => setSettleTimedOut(true), 2500)
        return () => window.clearTimeout(id)
    }, [realEntityId])
    const realConfigReady =
        !!realEntityId && (settleTimedOut || (realIsAgent && !realPendingHydration))

    const renderConfigOverride = !active
        ? undefined
        : !realEntityId
          ? createElement(OnboardingConfigPanel)
          : !realConfigReady
            ? createElement(OnboardingConfigSettling)
            : undefined

    return {
        ready: !!entityId,
        // The onboarding right panel IS the real AgentChatPanel (the agent-chat view) — "what do you
        // want to build?" is just an AgentChatEmptyState state + the same editor with different controls,
        // read from the OnboardingContext. So we DON'T override the generation panel; Playground uses its
        // default AgentChatPanel. (OnboardingAgentPanel is now dead code — removed at cleanup.)
        agentPanel: null,
        renderConfigOverride,
        contextValue,
    }
}
