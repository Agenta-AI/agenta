import {QueryClientProvider} from "@tanstack/react-query"
import {App as AppComponent} from "antd"
import {enableMapSet} from "immer"
import {useAtomValue} from "jotai"
import type {AppProps} from "next/app"
import dynamic from "next/dynamic"
import {Inter} from "next/font/google"
import {NextStepProvider} from "nextstepjs"

import ThemeContextProvider from "@/oss/components/Layout/ThemeContextProvider"
import GlobalScripts from "@/oss/components/Scripts/GlobalScripts"
import {queryClient} from "@/oss/lib/api/queryClient"
import AuthProvider from "@/oss/lib/helpers/auth/AuthProvider"
import {selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {useUser} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import GlobalStateProvider from "@/oss/state/Providers"
import ThemeContextBridge from "@/oss/ThemeContextBridge"

import AppGlobalWrappers from "../../AppGlobalWrappers"
import AppContextComponent from "../../AppMessageContext"
import CustomNextStepProvider from "../../Onboarding/components/CustomNextStepProvider"

enableMapSet()

const NoMobilePageWrapper = dynamic(
    () => import("@/oss/components/NoMobilePageWrapper/NoMobilePageWrapper"),
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
                <NextStepProvider>
                    <QueryClientProvider client={queryClient}>
                        <AuthProvider pageProps={pageProps}>
                            <GlobalStateProvider>
                                <CustomNextStepProvider>
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
                                </CustomNextStepProvider>
                            </GlobalStateProvider>
                        </AuthProvider>
                    </QueryClientProvider>
                </NextStepProvider>
            </main>
        </>
    )
}
