import AppMessageContext from "@agenta/ui/app-message"
import {useVisualViewportHeight} from "@agenta/ui/hooks"
import type {AppProps} from "next/app"
import Head from "next/head"

import {AppProviders} from "@/features/app/AppProviders"
import {GlobalDrawers} from "@/features/app/GlobalDrawers"

import "@/styles/globals.css"

// Deliberately minimal: no provider fleet (the desktop _app's ~10 providers
// are the reason this app exists as a separate bundle). AppProviders holds
// only what the data layer needs: query client + jotai default store + SDK
// host pin + route→project sync.
export default function App({Component, pageProps}: AppProps) {
    // iOS Safari ignores `interactive-widget`, so on that browser the keyboard still opens over the
    // page and every `dvh` frame keeps its full height. This publishes the visible height as
    // `--ag-viewport-height`, which ScreenScaffold, AppShell and SessionWorkspace read with a
    // `100dvh` fallback. One mount here covers every screen. Idle when no keyboard is open.
    useVisualViewportHeight()

    return (
        <>
            <Head>
                {/* `interactive-widget=resizes-content` makes the on-screen keyboard shrink
                    the LAYOUT viewport, so every `dvh` frame below stops hiding its bottom edge —
                    the composer — behind the keyboard. Chrome and Android honour it. iOS Safari
                    ignores it, and `useVisualViewportHeight` below covers that half.
                    `viewport-fit=cover` stays: this app draws real safe-area insets. */}
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
                />
            </Head>
            <AppProviders>
                <Component {...pageProps} />
                {/* The imperative message/modal outlet the SHARED session verbs render their
                    confirms into (rename, delete). Antd-free — it is the kit's own
                    reimplementation of that API, not antd's App context. */}
                <AppMessageContext />
                <GlobalDrawers />
            </AppProviders>
        </>
    )
}
