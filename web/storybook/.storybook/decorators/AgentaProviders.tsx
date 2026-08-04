import React from "react"

import ThemeContextProvider from "@agenta/oss/src/components/Layout/ThemeContextProvider"
import {default as AppMessageBridge} from "@agenta/ui/app-message"
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query"
import {App as AntApp} from "antd"
import {getDefaultStore, Provider as JotaiProvider} from "jotai"

import {defaultStoryQueryClient} from "./withAgentaData"

// The REAL app theme provider (ConfigProvider + antd theme + cssVar:{key:"agenta"} +
// .agenta/.dark class wiring). Reused verbatim so Storybook renders exactly what the
// app renders — no re-derived token math.

// The app renders `<Provider store={getDefaultStore()}>` (oss/src/state/Providers.tsx:26)
// because ~120 files reach for `getDefaultStore()` imperatively (molecule.set.*, bridges).
// A bare `<Provider>` mints an isolated store, so React would read one store while those
// writes land in another — silently, with no error. Match the app: same store.
const sharedStore = getDefaultStore()

export type StoryTheme = "light" | "dark"

/**
 * Minimal, styling-faithful subset of the app provider tree (from
 * web/oss/src/components/pages/_app). Skips auth/router/analytics/layout which do
 * not affect component appearance. `key={theme}` remounts ThemeContextProvider so it
 * re-reads the forced localStorage mode when the toolbar toggles light/dark.
 */
export function AgentaProviders({
    theme,
    queryClient = defaultStoryQueryClient(),
    children,
}: {
    theme: StoryTheme
    queryClient?: QueryClient
    children: React.ReactNode
}) {
    if (typeof window !== "undefined") {
        try {
            // usehooks-ts useLocalStorage JSON-parses its value, so it must be stored
            // JSON-encoded ('"light"'), not as a raw string, or it falls back to System.
            window.localStorage.setItem("agenta-theme", JSON.stringify(theme))
        } catch {
            /* ignore */
        }
    }

    return (
        <JotaiProvider store={sharedStore}>
            <QueryClientProvider client={queryClient}>
                <ThemeContextProvider key={theme}>
                    <AntApp>
                        {/* Wires antd static message/modal/notification to the theme. */}
                        <AppMessageBridge />
                        <div className="p-6">{children}</div>
                    </AntApp>
                </ThemeContextProvider>
            </QueryClientProvider>
        </JotaiProvider>
    )
}

export default AgentaProviders
