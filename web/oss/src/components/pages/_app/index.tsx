import {default as AppContextComponent} from "@agenta/ui/app-message"
import {configureAxios} from "@agenta/shared/api"
import {QueryClientProvider} from "@tanstack/react-query"
import {App as AppComponent} from "antd"
import {enableMapSet} from "immer"
import {getDefaultStore, useAtomValue} from "jotai"
import type {AppProps} from "next/app"
import dynamic from "next/dynamic"
import {Inter} from "next/font/google"

import ThemeContextProvider from "@/oss/components/Layout/ThemeContextProvider"
import {OnboardingProvider} from "@/oss/components/Onboarding"
import GlobalScripts from "@/oss/components/Scripts/GlobalScripts"
import {playgroundEmbedResolutionViewModeAtom} from "@/oss/components/Playground/state/atoms"
import {queryClient} from "@/oss/lib/api/queryClient"
import AuthProvider from "@/oss/lib/helpers/auth/AuthProvider"
import {selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {useUser} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import GlobalStateProvider from "@/oss/state/Providers"
import ThemeContextBridge from "@/oss/ThemeContextBridge"

import AppGlobalWrappers from "../../AppGlobalWrappers"

enableMapSet()

const isVariantsRevisionsQueryRequest = (url: string) =>
    url.includes("/variants/revisions/query")

const parseJsonLikeData = (data: unknown): Record<string, unknown> => {
    if (!data) return {}
    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data) as unknown
            return parsed && typeof parsed === "object"
                ? (parsed as Record<string, unknown>)
                : {}
        } catch {
            return {}
        }
    }
    if (typeof data === "object") {
        return data as Record<string, unknown>
    }
    return {}
}

configureAxios({
    requestInterceptor: (config) => {
        const fullUrl = `${config.baseURL ?? ""}${config.url ?? ""}`
        if (!isVariantsRevisionsQueryRequest(fullUrl)) return config

        const payload = parseJsonLikeData(config.data)
        const paramsRecord =
            config.params && typeof config.params === "object"
                ? (config.params as Record<string, unknown>)
                : {}

        const resolveFromBody =
            typeof payload.resolve === "boolean" ? (payload.resolve as boolean) : undefined
        const resolveFromQuery =
            typeof paramsRecord.resolve === "boolean"
                ? (paramsRecord.resolve as boolean)
                : undefined
        const mode = getDefaultStore().get(playgroundEmbedResolutionViewModeAtom)
        const resolve = resolveFromBody ?? resolveFromQuery ?? mode === "resolved"

        payload.resolve = resolve
        config.data = payload
        config.params = {...paramsRecord, resolve}
        return config
    },
})

const NoMobilePageWrapper = dynamic(
    () => import("@/oss/components/Placeholders/NoMobilePageWrapper/NoMobilePageWrapper"),
    {
        ssr: false,
    },
)
const CustomPosthogProvider = dynamic(() => import("@/oss/lib/helpers/analytics/AgPosthogProvider"))
const Layout = dynamic(() => import("@/oss/components/Layout/Layout"), {
    ssr: false,
})

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

const PreloadQueries = () => {
    useAtomValue(selectedOrgIdAtom)
    useUser()
    useProjectData()

    return null
}

export default function App({Component, pageProps, ...rest}: AppProps) {
    return (
        <>
            <GlobalScripts />

            <main className={`${inter.variable} font-sans`}>
                <QueryClientProvider client={queryClient}>
                    <AuthProvider pageProps={pageProps}>
                        <GlobalStateProvider>
                            <OnboardingProvider>
                                <CustomPosthogProvider
                                    config={{
                                        persistence: "localStorage+cookie",
                                    }}
                                >
                                    <ThemeContextProvider>
                                        <AppComponent>
                                            <ThemeContextBridge>
                                                <PreloadQueries />
                                                <Layout>
                                                    <AppContextComponent />
                                                    <Component {...pageProps} />
                                                    <NoMobilePageWrapper />
                                                </Layout>
                                                <AppGlobalWrappers />
                                            </ThemeContextBridge>
                                        </AppComponent>
                                    </ThemeContextProvider>
                                </CustomPosthogProvider>
                            </OnboardingProvider>
                        </GlobalStateProvider>
                    </AuthProvider>
                </QueryClientProvider>
            </main>
        </>
    )
}
