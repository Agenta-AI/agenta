import {useEffect} from "react"
import type {AppProps} from "next/app"
import {useRouter} from "next/router"

import posthog from "posthog-js"
import {PostHogProvider} from "posthog-js/react"

import "@/styles/globals.css"
import Layout from "@/components/Layout/Layout"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"
import ProfileContextProvider from "@/contexts/profile.context"

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
        <PostHogProvider client={posthog}>
            <ThemeContextProvider>
                <ProfileContextProvider>
                    <AppContextProvider>
                        <Layout>
                            <Component {...pageProps} />
                        </Layout>
                    </AppContextProvider>
                </ProfileContextProvider>
            </ThemeContextProvider>
        </PostHogProvider>
    )
}
