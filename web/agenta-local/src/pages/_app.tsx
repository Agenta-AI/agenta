import "@/styles/globals.css"

import type {AppProps} from "next/app"
import Head from "next/head"

import {AppProviders} from "@/features/app/AppProviders"
import {AppShell} from "@/features/app/AppShell"

export default function LocalApp({Component, pageProps}: AppProps) {
    return (
        <AppProviders>
            <Head>
                <title>Agenta Local</title>
                <meta name="description" content="Build and run private agents on this machine." />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/assets/favicon.ico" />
            </Head>
            <AppShell>
                <Component {...pageProps} />
            </AppShell>
        </AppProviders>
    )
}
