import React, {useLayoutEffect} from "react"

import {default as AppMessageContext} from "@agenta/ui/app-message"
import {QueryClientProvider, type QueryClient} from "@tanstack/react-query"
import {getDefaultStore, Provider as JotaiProvider} from "jotai"

import {defaultStoryQueryClient} from "./withAgentaData"

// The app renders `<Provider store={getDefaultStore()}>` because many files reach for
// `getDefaultStore()` imperatively (molecule.set.*, bridges). A bare `<Provider>` mints an
// isolated store, so React would read one store while those writes land in another, silently.
// Match the app: same store.
const sharedStore = getDefaultStore()

export type StoryTheme = "light" | "dark"

/**
 * The styling-relevant subset of the /m app's provider tree (web/mobile/src/pages/_app.tsx).
 * Skips auth, router, analytics and layout, which do not change how a component looks. Dark
 * mode is the `.dark` class on <html>, as /m's _document.tsx sets it, plus the "agenta-theme"
 * localStorage key that `useThemeMode` reads.
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
    useLayoutEffect(() => {
        const root = document.documentElement
        root.classList.toggle("dark", theme === "dark")
        root.style.colorScheme = theme
        try {
            // usehooks-ts useLocalStorage JSON-parses its value, so store it JSON-encoded.
            window.localStorage.setItem("agenta-theme", JSON.stringify(theme))
        } catch {
            /* ignore */
        }
    }, [theme])

    return (
        <JotaiProvider store={sharedStore}>
            <QueryClientProvider client={queryClient}>
                <div className="bg-background p-6 text-foreground">{children}</div>
                <AppMessageContext />
            </QueryClientProvider>
        </JotaiProvider>
    )
}

export default AgentaProviders
