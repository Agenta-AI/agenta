import type {PropsWithChildren} from "react"

import {QueryClientProvider} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {queryClient} from "@/lib/queryClient"

const HydrateAtoms = ({children}: PropsWithChildren) => {
    useHydrateAtoms([[queryClientAtom, queryClient]])
    return children
}

/** The data layer alone, for the embed widget: no auth gate, project watch or analytics. */
export const BareProviders = ({children}: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
        <Provider store={getDefaultStore()}>
            <HydrateAtoms>{children}</HydrateAtoms>
        </Provider>
    </QueryClientProvider>
)
