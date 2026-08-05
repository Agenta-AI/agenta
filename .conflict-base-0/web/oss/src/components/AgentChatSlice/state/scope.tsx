import {createContext, useContext, type ReactNode} from "react"

import {useAtomValue} from "jotai"

import {defaultScopeKeyAtom} from "./sessions"

/**
 * Scope key for the agent chat session state. Distinct surfaces that mount `AgentChatPanel`
 * concurrently — the main playground vs the create/edit drawer that overlays it — must use
 * different scope keys, or they share tabs/history (a drawer would inherit and overwrite the
 * playground's conversations). The provider lets a surface override the default app scope;
 * every consumer reads the effective key via `useChatScopeKey()`.
 */
const AgentChatScopeContext = createContext<string | null>(null)

export function AgentChatScopeProvider({
    scopeKey,
    children,
}: {
    scopeKey: string
    children: ReactNode
}) {
    return (
        <AgentChatScopeContext.Provider value={scopeKey}>{children}</AgentChatScopeContext.Provider>
    )
}

/** The effective chat scope key: a surface override when provided, else the app scope. */
export function useChatScopeKey(): string {
    const override = useContext(AgentChatScopeContext)
    const fallback = useAtomValue(defaultScopeKeyAtom)
    return override ?? fallback
}

/**
 * Drawer scope key for an entity. Prefixed so it never collides with an app scope (app keys are
 * bare UUIDs or `__global__`); a pre-creation drawer with no entity id yet falls back to `new`.
 */
export const drawerScopeKey = (entityId: string | null | undefined): string =>
    `drawer:${entityId || "new"}`

/**
 * Scope key for the playground-native onboarding surface. The onboarding playground runs on the
 * PROJECT route (no app id), so without an override it would fall back to the shared `__global__`
 * app scope and inherit whatever conversation the previous app-less visit left there (a stale/failed
 * run leaking into a "fresh start"). A dedicated, fixed key isolates it; the onboarding wipes this
 * scope clean on entry (see `resetScopeAtomFamily`) so every onboarding starts empty.
 */
export const ONBOARDING_SCOPE_KEY = "onboarding"
