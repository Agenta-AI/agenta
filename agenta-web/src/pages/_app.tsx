import "@/styles/globals.css"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import type {AppProps} from "next/app"
import Layout from "@/components/Layout/Layout"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"

export default function App({Component, pageProps}: AppProps) {
    return (
        <ThemeContextProvider>
            <Layout>
                <Component {...pageProps} />
            </Layout>
        </ThemeContextProvider>
    )
}
