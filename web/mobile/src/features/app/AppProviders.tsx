import type {PropsWithChildren} from "react"

import {configureAgentaSdk} from "@agenta/sdk/config"
import {QueryClientProvider} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {ensureAuthInit} from "@/lib/auth"
import {getApiUrl} from "@/lib/env"
import {queryClient} from "@/lib/queryClient"

import {AuthGate} from "./AuthGate"
import {ContextSync} from "./ContextSync"
import {ExecutionHeaders} from "./ExecutionHeaders"
import {ProjectWatch} from "./ProjectWatch"

// Module scope, like the desktop _app: __env.js is beforeInteractive, so
// window.__env is already populated when this module first evaluates.
configureAgentaSdk({host: getApiUrl()})
// Install the SuperTokens fetch interceptor before any API call — it is what
// transparently refreshes an expired access token on 401 (desktop parity);
// without it only fetchProjects' explicit retry path could heal a 401.
ensureAuthInit()

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
                <AuthGate />
                {/* Keeps the session lists live: without it nothing on this surface told them the
                    server had changed, so they showed stale rows until a remount. */}
                <ProjectWatch />
                <ExecutionHeaders />
                {children}
            </HydrateAtoms>
        </Provider>
    </QueryClientProvider>
)
