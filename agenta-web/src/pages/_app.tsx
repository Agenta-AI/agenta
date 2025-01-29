import type {AppProps} from "next/app"
import dynamic from "next/dynamic"

import "@/styles/globals.css"
import Layout from "@/components/Layout/Layout"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"
import ProfileContextProvider from "@/contexts/profile.context"
import ProjectContextProvider from "@/contexts/project.context"
import AuthProvider from "@/lib/helpers/auth/AuthProvider"
import GlobalScripts from "@/components/Scripts/GlobalScripts"
import {Inter} from "next/font/google"
import AgSWRConfig from "@/lib/api/SWRConfig"
import {useSentryIntegrations} from "@/lib/helpers/sentry/hook/useSentryIntegrations"
import OrgContextProvider from "@/contexts/org.context"
import {App as AppComponent} from "antd"

const NoMobilePageWrapper = dynamicComponent("NoMobilePageWrapper/NoMobilePageWrapper")
const CustomPosthogProvider = dynamic(() => import("@/lib/helpers/analytics/AgPosthogProvider"))

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

export default function App({Component, pageProps}: AppProps) {
    useSentryIntegrations()

    return (
        <>
            <GlobalScripts />

            <main className={`${inter.variable} font-sans`}>
                <AgSWRConfig>
                    <CustomPosthogProvider
                        config={{
                            persistence: "localStorage+cookie",
                        }}
                    >
                        <AuthProvider pageProps={pageProps}>
                            <ThemeContextProvider>
                                <ProfileContextProvider>
                                    <OrgContextProvider>
                                        <ProjectContextProvider>
                                            <AppContextProvider>
                                                <AppComponent>
                                                    <Layout>
                                                        <Component {...pageProps} />
                                                        <NoMobilePageWrapper />
                                                    </Layout>
                                                </AppComponent>
                                            </AppContextProvider>
                                        </ProjectContextProvider>
                                    </OrgContextProvider>
                                </ProfileContextProvider>
                            </ThemeContextProvider>
                        </AuthProvider>
                    </CustomPosthogProvider>
                </AgSWRConfig>
            </main>
        </>
    )
}
