import type {PropsWithChildren} from "react"

import {configureAgentaSdk} from "@agenta/sdk/config"
import {QueryClientProvider} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {getApiUrl} from "@/lib/env"
import {queryClient} from "@/lib/queryClient"

import {ContextSync} from "./ContextSync"

// Module scope, like the desktop _app: __env.js is beforeInteractive, so
// window.__env is already populated when this module first evaluates.
configureAgentaSdk({host: getApiUrl()})

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
                {children}
            </HydrateAtoms>
        </Provider>
    </QueryClientProvider>
)
