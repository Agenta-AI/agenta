/**
 * MockupShell
 *
 * Top-level provider wrapper for the design-mockups app. Mirrors the
 * OSS app's provider tree (JotaiProvider → ConfigProvider with the real
 * antd theme JSON → DrillIn UI provider) so the production drill-in
 * components render with the same theme/typography/tokens as in OSS.
 *
 * Loads the same `antd-themeConfig.json` the OSS app loads (copied to
 * `src/styles/tokens/`), and the Inter font via next/font/google so
 * Ant Design components match the production look.
 */

import type {ReactNode} from "react"

import {Inter} from "next/font/google"
import {ConfigProvider, theme as antdTheme} from "antd"
import {Provider as JotaiProvider} from "jotai"

import antdTokens from "@/mockups/styles/tokens/antd-themeConfig.json"

import {MockupDrillInUIProvider} from "./MockupDrillInUIProvider"

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

interface MockupShellProps {
    children: ReactNode
}

export function MockupShell({children}: MockupShellProps) {
    return (
        <div
            className={inter.variable}
            style={{
                height: "100%",
                // Apply the resolved font-family directly on the wrapper. We
                // can't put `font-family: var(--font-inter)` in globals.css
                // body{} because the CSS variable is defined on this wrapper
                // (a descendant of body) — vars cascade down, not up.
                fontFamily: inter.style.fontFamily,
            }}
        >
            <JotaiProvider>
                <ConfigProvider
                    theme={{
                        algorithm: antdTheme.defaultAlgorithm,
                        token: {
                            fontFamily: inter.style.fontFamily,
                            fontFamilyCode: inter.style.fontFamily,
                            ...antdTokens.token,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            ...((antdTokens as any).components ?? {}),
                        },
                    }}
                >
                    <MockupDrillInUIProvider>{children}</MockupDrillInUIProvider>
                </ConfigProvider>
            </JotaiProvider>
        </div>
    )
}

export default MockupShell
