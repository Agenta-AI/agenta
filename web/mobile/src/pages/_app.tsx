import type {AppProps} from "next/app"
import Head from "next/head"

import "@/styles/globals.css"

// Deliberately minimal: no provider fleet (the desktop _app's ~10 providers
// are the reason this app exists as a separate bundle). Providers are added
// per concern when a feature needs them (auth/session first, in WP2).
export default function App({Component, pageProps}: AppProps) {
    return (
        <>
            <Head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, viewport-fit=cover"
                />
            </Head>
            <Component {...pageProps} />
        </>
    )
}
