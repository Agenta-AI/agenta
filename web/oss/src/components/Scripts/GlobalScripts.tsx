import dynamic from "next/dynamic"
import Head from "next/head"

import {isDemo} from "@/oss/lib/helpers/utils"

const CloudScripts = dynamic(() => import("@/oss/components/Scripts/assets/CloudScripts"), {
    ssr: false,
})

const GlobalScripts = () => {
    return (
        <>
            <Head>
                <title>Agenta – the open-source workspace for building and running agents</title>
                {/*
                 * Next ships `width=device-width` by default. The addition that matters is
                 * `interactive-widget=resizes-content`: it makes the on-screen keyboard shrink the
                 * layout viewport, so `100dvh` frames (the playground) stop hiding their bottom
                 * edge — the chat composer — behind the keyboard. Chrome and Android honour it;
                 * iOS Safari ignores it and is handled by `useVisualViewportHeight` instead.
                 * `viewport-fit` stays at its default: the app draws no safe-area insets, so
                 * `cover` would push content under the notch.
                 */}
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
                />
                <link rel="shortcut icon" href="/assets/favicon.ico" />
            </Head>
            {isDemo() ? <CloudScripts /> : null}
        </>
    )
}

export default GlobalScripts
