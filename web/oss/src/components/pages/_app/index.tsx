import {default as AppContextComponent} from "@agenta/ui/app-message"
import {QueryClientProvider} from "@tanstack/react-query"
import {App as AppComponent} from "antd"
import {enableMapSet} from "immer"
import {useAtomValue} from "jotai"
import type {AppProps} from "next/app"
import dynamic from "next/dynamic"
import {Inter} from "next/font/google"

import ThemeContextProvider from "@/oss/components/Layout/ThemeContextProvider"
import {OnboardingProvider} from "@/oss/components/Onboarding"
import GlobalScripts from "@/oss/components/Scripts/GlobalScripts"
import {queryClient} from "@/oss/lib/api/queryClient"
import AuthProvider from "@/oss/lib/helpers/auth/AuthProvider"
import {selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {useUser} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import GlobalStateProvider from "@/oss/state/Providers"
import ThemeContextBridge from "@/oss/ThemeContextBridge"

import AppGlobalWrappers from "../../AppGlobalWrappers"

enableMapSet()

const RESOLVE_MODE_STORAGE_KEY = "agenta:playground:embed-resolution-view"
const FETCH_PATCH_FLAG = "__agentaResolvePatched__"

const getResolveModeFromStorage = (): boolean => {
    if (typeof window === "undefined") return false
    const mode = window.localStorage.getItem(RESOLVE_MODE_STORAGE_KEY)
    return mode === "resolved"
}

const tryParseJsonBody = (body: BodyInit | null | undefined): Record<string, unknown> => {
    if (!body) return {}
    if (typeof body === "string") {
        try {
            const parsed = JSON.parse(body) as unknown
            return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
        } catch {
            return {}
        }
    }
    return {}
}

const shouldPatchResolveUrl = (url: string): boolean => {
    return (
        url.includes("/api/variants/revisions/query") || url.includes("/variants/revisions/query")
    )
}

const patchGlobalFetchForResolve = () => {
    if (typeof window === "undefined") return
    const w = window as typeof window & {[FETCH_PATCH_FLAG]?: boolean}
    if (w[FETCH_PATCH_FLAG]) return

    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

        if (!shouldPatchResolveUrl(url)) {
            return originalFetch(input as any, init)
        }

        const effectiveResolve = getResolveModeFromStorage()

        const reqInit: RequestInit = {...(init ?? {})}
        const baseBody = tryParseJsonBody(reqInit.body)
        const patchedBody = {
            ...baseBody,
            resolve: effectiveResolve,
        }
        reqInit.body = JSON.stringify(patchedBody)
        reqInit.method = reqInit.method ?? "POST"

        const headers = new Headers(reqInit.headers)
        headers.set("Content-Type", "application/json")
        headers.set("x-agenta-resolve-source", "oss.global-fetch-patch")
        headers.set("x-agenta-resolve-value", String(effectiveResolve))
        reqInit.headers = headers

        const patchedUrl = new URL(url, window.location.origin)
        patchedUrl.searchParams.set("resolve", String(effectiveResolve))

        const targetUrl = url.startsWith("http")
            ? patchedUrl.toString()
            : `${patchedUrl.pathname}${patchedUrl.search}${patchedUrl.hash}`

        return originalFetch(targetUrl, reqInit)
    }

    w[FETCH_PATCH_FLAG] = true
}

patchGlobalFetchForResolve()

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
