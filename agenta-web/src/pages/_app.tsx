import {useEffect} from "react"
import type {AppProps} from "next/app"
import {useRouter} from "next/router"
import Head from "next/head"
import dynamic from "next/dynamic"

import posthog from "posthog-js"
import {PostHogProvider} from "posthog-js/react"

import "@/styles/globals.css"
import Layout from "@/components/Layout/Layout"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"
import ProfileContextProvider from "@/contexts/profile.context"
import ProjectContextProvider from "@/contexts/project.context"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {Inter} from "next/font/google"
import AgSWRConfig from "@/lib/api/SWRConfig"

const NoMobilePageWrapper = dynamicComponent("NoMobilePageWrapper/NoMobilePageWrapper")

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

// Initialize the Posthog client
if (typeof window !== "undefined") {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_API_KEY!, {
        api_host: "https://app.posthog.com",
        // Enable debug mode in development
        loaded: (posthog) => {
            if (process.env.NODE_ENV === "development") posthog.debug()
        },
        capture_pageview: false,
        persistence: "localStorage+cookie",
    })
}

export default function App({Component, pageProps}: AppProps) {
    const router = useRouter()

    useEffect(() => {
        const handleRouteChange = () =>
            posthog.capture("$pageview", {$current_url: window.location.href})
        router.events.on("routeChangeComplete", handleRouteChange)

        return () => {
            router.events.off("routeChangeComplete", handleRouteChange)
        }
    }, [])
    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
            </Head>
            <main className={`${inter.variable} font-sans`}>
                <AgSWRConfig>
                    <PostHogProvider client={posthog}>
                        <ThemeContextProvider>
                            <ProfileContextProvider>
                                <ProjectContextProvider>
                                    <AppContextProvider>
                                        <Layout>
                                            <Component {...pageProps} />
                                            <NoMobilePageWrapper />
                                        </Layout>
                                    </AppContextProvider>
                                </ProjectContextProvider>
                            </ProfileContextProvider>
                        </ThemeContextProvider>
                    </PostHogProvider>
                </AgSWRConfig>
            </main>
        </>
    )
}
