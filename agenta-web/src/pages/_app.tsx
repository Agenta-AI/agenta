import "@/styles/globals.css"
import posthog from "posthog-js"
import type {AppProps} from "next/app"
import {PostHogProvider} from "posthog-js/react"
import Layout from "@/components/Layout/Layout"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"
import ProfileContextProvider from "@/contexts/profile.context"

// Initialize the Posthog client
if (typeof window !== "undefined") {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_SECRET_KEY as string, {
        api_host: "https://app.posthog.com",
        // Enable debug mode in development
        loaded: (posthog) => {
            if (process.env.NODE_ENV === "development") posthog.debug()
        },
        capture_pageview: false,
    })
}

export default function App({Component, pageProps}: AppProps) {
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
