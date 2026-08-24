import {queryClient} from "@agenta/shared/api"
import {QueryClientProvider} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"
import type {PropsWithChildren} from "react"

import {ThemeProvider} from "./ThemeProvider"

const HydrateQueryClient = ({children}: PropsWithChildren) => {
    useHydrateAtoms([[queryClientAtom, queryClient]])
    return children
}

export const AppProviders = ({children}: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
        <Provider store={getDefaultStore()}>
            <HydrateQueryClient>
                <ThemeProvider>{children}</ThemeProvider>
            </HydrateQueryClient>
        </Provider>
    </QueryClientProvider>
)
