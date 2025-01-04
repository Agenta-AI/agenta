import type {AppProps} from "next/app"
import Head from "next/head"
import dynamic from "next/dynamic"
import "@/styles/globals.css"
import Layout from "@/components/Layout/Layout"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import ThemeContextProvider from "@/components/Layout/ThemeContextProvider"
import AppContextProvider from "@/contexts/app.context"
import ProfileContextProvider from "@/contexts/profile.context"
import ProjectContextProvider from "@/contexts/project.context"
import AgSWRConfig from "@/lib/api/SWRConfig"

const NoMobilePageWrapper = dynamicComponent("NoMobilePageWrapper/NoMobilePageWrapper")
const CustomPosthogProvider = dynamic(() => import("@/lib/helpers/analytics/AgPosthogProvider"))

export default function App({Component, pageProps}: AppProps) {
    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
            </Head>
            <main className={`font-sans`}>
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
                                        <Layout>
                                            <Component {...pageProps} />
                                            <NoMobilePageWrapper />
                                        </Layout>
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
