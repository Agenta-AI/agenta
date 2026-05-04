import type {AppProps} from "next/app"

import {MockupShell} from "@/mockups/components/MockupShell"

import "@/mockups/styles/globals.css"

export default function App({Component, pageProps}: AppProps) {
    return (
        <MockupShell>
            <Component {...pageProps} />
        </MockupShell>
    )
}
