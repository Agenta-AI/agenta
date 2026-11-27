import {Inter, JetBrains_Mono} from "next/font/google"
import Head from "next/head"

// Self-hosted at build time; the theme's --font-sans / --font-mono read these variables first.
const inter = Inter({subsets: ["latin"], display: "swap"})
const jetBrainsMono = JetBrains_Mono({subsets: ["latin"], display: "swap"})

const fontVariables = `:root{--font-inter:${inter.style.fontFamily};--font-jetbrains-mono:${jetBrainsMono.style.fontFamily};}`

export function AppFonts() {
    return (
        <Head>
            <style key="ag-font-variables" dangerouslySetInnerHTML={{__html: fontVariables}} />
        </Head>
    )
}
