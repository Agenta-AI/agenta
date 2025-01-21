import Head from "next/head"
import dynamic from "next/dynamic"

import "@/styles/globals.css"
import Layout from "@/components/Layout/Layout"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"
import ProfileContextProvider from "@/contexts/profile.context"
import ProjectContextProvider from "@/contexts/project.context"
import {Inter} from "next/font/google"
import AgSWRConfig from "@/lib/api/SWRConfig"
import {App as AppComponent} from "antd"
import type {AppProps} from "next/app"

const NoMobilePageWrapper = dynamicComponent("NoMobilePageWrapper/NoMobilePageWrapper")
const CustomPosthogProvider = dynamic(() => import("@/lib/helpers/analytics/AgPosthogProvider"))

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

export default function App({Component, pageProps}: AppProps) {
    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
            </Head>
            <main className={`${inter.variable} font-sans`}>
                <AgSWRConfig>
                    <CustomPosthogProvider
                        config={{
                            persistence: "localStorage+cookie",
                        }}
                    >
                        <ThemeContextProvider>
                            <ProfileContextProvider>
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
                            </ProfileContextProvider>
                        </ThemeContextProvider>
                    </CustomPosthogProvider>
                </AgSWRConfig>
            </main>
        </>
    )
}
