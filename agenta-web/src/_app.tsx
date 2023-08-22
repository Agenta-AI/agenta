import "@/styles/globals.css"
import type {AppProps} from "next/app"
import Layout from "@/components/Layout/Layout"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"

import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"
import {frontendConfig} from "./config/frontendConfig"

if (typeof window !== "undefined") {
    SuperTokensReact.init(frontendConfig())
}
export default function App({Component, pageProps}: AppProps) {
    return (
        <SuperTokensWrapper>
            <ThemeContextProvider>
                <Layout>
                    <Component {...pageProps} />
                </Layout>
            </ThemeContextProvider>
        </SuperTokensWrapper>
    )
}
