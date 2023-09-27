import "@/styles/globals.css"
import type {AppProps} from "next/app"
import Layout from "@/components/Layout/Layout"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"

export default function App({Component, pageProps}: AppProps) {
    return (
        <ThemeContextProvider>
            <AppContextProvider>
                <Layout>
                    <Component {...pageProps} />
                </Layout>
            </AppContextProvider>
        </ThemeContextProvider>
    )
}
