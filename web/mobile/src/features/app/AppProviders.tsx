import type {PropsWithChildren} from "react"

import {EntityModalsProvider} from "@agenta/entity-ui/modals"
import {configureAgentaSdk} from "@agenta/sdk/config"
import {ProjectWatch} from "@agenta/sessions/watch"
import {schedulePersistedQueryGc} from "@agenta/shared/api/persist"
import {QueryClientProvider} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {Analytics} from "@/features/analytics/Analytics"
import {SessionShareHost} from "@/features/chat/SessionShareHost"
import {isEmbedPath} from "@/features/embed/embedRoute"
import {ensureAuthInit, tryRefreshSession} from "@/lib/auth"
import {getApiUrl} from "@/lib/env"
import {queryClient} from "@/lib/queryClient"

import {AuthGate} from "./AuthGate"
import {ContextSync} from "./ContextSync"
import {registerExecutionHeaders} from "./executionHeaders"
import {LanguageSync} from "./LanguageSync"
import {PostAuthLoader} from "./PostAuthLoader"

// Module scope, like the desktop _app: __env.js is beforeInteractive, so
// window.__env is already populated when this module first evaluates.
configureAgentaSdk({host: getApiUrl()})
// Install the SuperTokens fetch interceptor before any API call — it is what
// transparently refreshes an expired access token on 401 (desktop parity);
// without it only fetchProjects' explicit retry path could heal a 401.
// Not on the embed widget: it has no login, and its 401s must not refresh a session.
if (typeof window === "undefined" || !isEmbedPath(window.location.pathname)) ensureAuthInit()
// Without it, expired and stale-buster IndexedDB entries are never swept.
schedulePersistedQueryGc()
// Before any page renders, so the first run after a cold load already sends the header.
registerExecutionHeaders()

const HydrateAtoms = ({children}: PropsWithChildren) => {
    useHydrateAtoms([[queryClientAtom, queryClient]])
    return children
}

export const AppProviders = ({children}: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
        {/* default store — @agenta/chat's loadSessionMessages writes through getDefaultStore() */}
        <Provider store={getDefaultStore()}>
            <HydrateAtoms>
                <ContextSync />
                <LanguageSync />
                <Analytics />
                {/* The project's only live revalidation channel — without it every project list
                    here waits out its stale time and a remount. */}
                <ProjectWatch refreshSession={tryRefreshSession} />
                <AuthGate />
                {/* useEntityActionDispatch throws without this; the modals stay unmounted
                    until something dispatches, so nothing renders differently today. */}
                <EntityModalsProvider>{children}</EntityModalsProvider>
                <PostAuthLoader />
                {/* The chat Share dialog: the tab strip and every session row menu open it. */}
                <SessionShareHost />
            </HydrateAtoms>
        </Provider>
    </QueryClientProvider>
)
