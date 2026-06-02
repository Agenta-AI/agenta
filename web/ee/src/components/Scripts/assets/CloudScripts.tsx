import {useEffect} from "react"

import {ChatboxColors, Crisp} from "crisp-sdk-web"
import Head from "next/head"
import Script from "next/script"

import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

const CloudScripts = () => {
    const {appTheme} = useAppTheme()

    useEffect(() => {
        const isCrispEnabled = !!getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID")

        if (!isCrispEnabled) {
            return
        }

        Crisp.configure(getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID"))
    }, [])

    // The Crisp chatbox renders in its own cross-origin iframe, so we can't style
    // its light/dark theme from our CSS, and crisp-sdk-web exposes no runtime
    // light/dark toggle (only the accent color via setColorTheme). Darken the
    // accent in dark mode so the launcher/accent reads less out-of-place; light
    // restores the dashboard's "default" accent.
    //
    // TODO(dark-mode): for the chat WINDOW itself to render dark, enable dark mode
    // in the Crisp dashboard (Settings → Chatbox → Appearance). That follows the
    // visitor's *system* color scheme — the SDK has no API to bind it to our
    // in-app theme toggle, so this accent tweak is the only code-side lever.
    useEffect(() => {
        const isCrispEnabled = !!getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID")

        if (!isCrispEnabled) {
            return
        }

        Crisp.setColorTheme(
            appTheme === ThemeMode.Dark ? ChatboxColors.Black : ChatboxColors.Default,
        )
    }, [appTheme])

    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
            </Head>
            <Script
                src="https://app.termly.io/embed.min.js/8e05e2f3-b396-45dd-bb76-4dfa5ce28e10?autoBlock=on"
                strategy="afterInteractive"
            />
        </>
    )
}

export default CloudScripts
