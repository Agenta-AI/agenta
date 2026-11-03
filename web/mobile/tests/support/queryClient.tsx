import type {ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"

/** A fresh, non-retrying query client per render, as the app's root provides one. */
export const WithQueryClient = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        {children}
    </QueryClientProvider>
)
