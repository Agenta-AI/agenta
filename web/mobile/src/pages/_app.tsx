import type {AppProps} from "next/app"
import Head from "next/head"

import {AppProviders} from "@/features/app/AppProviders"

import "@/styles/globals.css"

// Deliberately minimal: no provider fleet (the desktop _app's ~10 providers
// are the reason this app exists as a separate bundle). AppProviders holds
// only what the data layer needs: query client + jotai default store + SDK
// host pin + route→project sync.
export default function App({Component, pageProps}: AppProps) {
    return (
        <>
            <Head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, viewport-fit=cover"
                />
            </Head>
            <AppProviders>
                <Component {...pageProps} />
            </AppProviders>
        </>
    )
}
