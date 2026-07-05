import {
    type ComponentType,
    type ReactNode,
    createElement,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {createEphemeralAppFromTemplate, workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {ONBOARDING_SCOPE_KEY} from "@/oss/components/AgentChatSlice/state/scope"
import {resetScopeAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"
import {urlAtom} from "@/oss/state/url"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {useCreateAgent} from "../hooks/useCreateAgent"

import OnboardingConfigPanel from "./OnboardingConfigPanel"
import {type OnboardingContextValue} from "./OnboardingContext"

/** Filterable diagnostic log for the onboarding flow (search the console for "[agent-onboarding]"). */
const log = (...args: unknown[]) =>
    console.log("%c[agent-onboarding]", "color:#84cc16;font-weight:bold", ...args)

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
    const startedRef = useRef(false)

    // Mint one ephemeral agent when onboarding activates. Ref-guarded so it runs exactly once.
    // NOTE: deliberately NO abort-on-cleanup. React StrictMode double-invokes effects (setup → cleanup
    // → setup) and the ref-guard blocks the second setup, so aborting on the first cleanup would cancel
    // the ONLY mint attempt and leave entityId null forever (→ no ephemeral, no agent). The mint is
    // cheap and client-only; let it finish. The component instance survives the StrictMode cycle, so
    // setEntityId lands (and a genuine unmount mid-mint is a harmless no-op in React 18).
    useEffect(() => {
        if (!active) {
            log("hook inactive (onboarding off) — no-op")
            return
        }
        if (startedRef.current) return
        startedRef.current = true
        // Wipe the onboarding scope BEFORE the ephemeral is minted (→ before AgentChatPanel mounts and
        // seeds its session). The onboarding runs on the app-less project route and uses a fixed scope
        // key, so a prior visit's persisted conversation (e.g. a failed run) would otherwise be restored
        // into this "fresh" session. Runs once per mount (ref-guarded above).
        resetOnboardingScope()
        log(
            "activate → reset onboarding scope; minting ephemeral agent via createEphemeralAppFromTemplate({type:'agent'})…",
        )
        void createEphemeralAppFromTemplate({
            type: "agent",
            defaultName: "New agent",
            // Return as soon as the entity is seeded (flags → agent layout resolves at once); the schema
            // inspect round-trip resolves in the background (not needed for the pre-commit surface).
            deferInspect: true,
        })
            .then((id) => {
                if (id) {
                    log("✅ mint OK — ephemeral entityId =", id)
                    setEntityId(id)
                } else {
                    log("❌ mint returned NULL (no agent template / no projectId / fetch failed)")
                }
            })
            .catch((err) => log("❌ mint THREW:", err))
    }, [active])

    // Point the playground at the ephemeral (until it's committed to a real revision). `setEntityIds`
    // alone doesn't hold on the project route: `playgroundSyncAtom` reconciles the selection against the
    // URL's `?revisions`, so with no param it drops back to empty (→ no entity → the generic 50/50 split
    // + no agent chat). Writing the selection to the URL (the documented ephemeral pattern) keeps it
    // selected and lets the agent workflow type resolve, so `MainLayout` uses the agent layout.
    useEffect(() => {
        if (!active || !entityId || realEntityId) return
        log("selecting ephemeral → setEntityIds + writePlaygroundSelectionToQuery:", entityId)
        setEntityIds([entityId])
        writePlaygroundSelectionToQuery([entityId])
    }, [active, entityId, realEntityId, setEntityIds])

    // ── Live diagnostic: read back what the playground ACTUALLY has, so we can see whether the
    // selection holds and whether the ephemeral resolves to the "agent" workflow type. Logs on change.
    const selectedIds = useAtomValue(playgroundController.selectors.entityIds())
    const ephemeralWorkflowType = useAtomValue(
        useMemo(() => workflowMolecule.selectors.workflowType(entityId ?? ""), [entityId]),
    )
    useEffect(() => {
        if (!active) return
        log("state snapshot →", {
            entityId,
            realEntityId,
            committing,
            "playground.selectedEntityIds": selectedIds,
            "workflowType(entityId)": ephemeralWorkflowType,
            isAgent: ephemeralWorkflowType === "agent",
            "url.search": typeof window !== "undefined" ? window.location.search : "(ssr)",
        })
    }, [active, entityId, realEntityId, committing, selectedIds, ephemeralWorkflowType])

    // Commit the ephemeral into a real agent IN PLACE — reuse `useCreateAgent` with our existing
    // ephemeral + an `onCommitted` callback (no redirect): swap the entity, flip to the live chat, and
    // reflect the app in the URL via `history.replaceState` (a real nav to the app route is a different
    // Next page → would remount; a reload then lands on the app playground).
    const commit = useCallback(
        (seedMessage: string, name?: string) => {
            if (!entityId || committing || realEntityId) {
                log("commit ignored (no ephemeral / already committing / already committed)", {
                    entityId,
                    committing,
                    realEntityId,
                })
                return
            }
            log("commit start → committing ephemeral in place:", {entityId, name, seedMessage})
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
                    log("✅ committed → real:", {appId, revisionId})
                    setEntityIds([revisionId])
                    setRealEntityId(revisionId)
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
                ? {ephemeralId: entityId ?? "", realEntityId, committing, committingSeed, commit}
                : null,
        [active, entityId, realEntityId, committing, committingSeed, commit],
    )

    return {
        ready: !!entityId,
        // The onboarding right panel IS the real AgentChatPanel (the agent-chat view) — "what do you
        // want to build?" is just an AgentChatEmptyState state + the same editor with different controls,
        // read from the OnboardingContext. So we DON'T override the generation panel; Playground uses its
        // default AgentChatPanel. (OnboardingAgentPanel is now dead code — removed at cleanup.)
        agentPanel: null,
        renderConfigOverride:
            active && !realEntityId ? createElement(OnboardingConfigPanel) : undefined,
        contextValue,
    }
}
