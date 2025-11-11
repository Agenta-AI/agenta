import "@ant-design/v5-patch-for-react-19"
import "@/oss/styles/globals.css"
import {App as AppComponent} from "antd"
import {enableMapSet} from "immer"
import {Provider} from "jotai"
import type {AppProps} from "next/app"
import dynamic from "next/dynamic"
import {Inter} from "next/font/google"

import ThemeContextProvider from "@/oss/components/Layout/ThemeContextProvider"
import {traceDrawerJotaiStore} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import GlobalScripts from "@/oss/components/Scripts/GlobalScripts"
import AppContextProvider from "@/oss/contexts/app.context"
import OrgContextProvider from "@/oss/contexts/org.context"
import ProfileContextProvider from "@/oss/contexts/profile.context"
import ProjectContextProvider from "@/oss/contexts/project.context"
import AgSWRConfig from "@/oss/lib/api/SWRConfig"
import AuthProvider from "@/oss/lib/helpers/auth/AuthProvider"

import AppContextComponent from "../components/AppMessageContext"

enableMapSet()

const NoMobilePageWrapper = dynamic(
    () => import("@/oss/components/NoMobilePageWrapper/NoMobilePageWrapper"),
    {
        ssr: false,
    },
)
const TraceDrawer = dynamic(
    () => import("@/oss/components/Playground/Components/Drawers/TraceDrawer/TraceDrawer"),
    {ssr: false},
)
const CustomPosthogProvider = dynamic(() => import("@/oss/lib/helpers/analytics/AgPosthogProvider"))
const Layout = dynamic(() => import("@/oss/components/Layout/Layout"), {
    ssr: false,
})

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

export default function App({Component, pageProps, ...rest}: AppProps) {
    return (
        <Provider store={traceDrawerJotaiStore}>
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
                                                        <AppContextComponent />
                                                        <Component {...pageProps} />
                                                        <TraceDrawer />
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
        </Provider>
    )
}
