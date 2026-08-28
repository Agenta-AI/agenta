/**
 * The 404 page — the same full-screen surface in oss, ee and mobile.
 *
 * Deliberately signed-out: a bad link arrives from outside the app as often as from inside it,
 * so this reads the same whether or not a session exists. That is why it is here beside
 * `AuthShell` rather than in a product package, and why it is built from auth.css's scoped
 * tokens: the page ground, the yellow keycap and the surface button already exist there, and
 * this screen adds no colour of its own.
 *
 * Plain elements only, like everything else in this package — the desktop apps render it inside
 * antd and the mobile app inside shadcn, and it must not care which.
 *
 * Routing arrives as props because "home" is not the same place in each host, and because the
 * package has no router of its own.
 */
import {useEffect, useState} from "react"

import {AgentaMark, AgentaWordmark} from "./AgentaBrand"

/** Same for every host, so it is a constant rather than another prop each page has to pass. */
const ISSUES_URL = "https://github.com/Agenta-AI/agenta/issues"

export interface NotFoundScreenProps {
    /** Back-navigation, usually `router.back()`. Omitted, the primary button is not rendered. */
    onBack?: () => void
    /** The address that failed, printed small at the bottom beside the code. */
    path?: string
}

export const NotFoundScreen = ({onBack, path}: NotFoundScreenProps) => {
    // Next prerenders /404, where `asPath` is the literal "/404" rather than the address the
    // visitor asked for, so the real one can only be printed after mount — otherwise it
    // hydrates against different text.
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    return (
        <main className="auth-redesign relative flex min-h-dvh w-full flex-col">
            <div className="px-9 pt-7">
                {/* 104x23 keeps the SVG's 361:80 ratio at the sign-in page's brand height. */}
                <AgentaWordmark width={104} height={23} markClassName="fill-current" />
            </div>

            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                <div className="auth-404-digits" role="img" aria-label="404">
                    <span aria-hidden>4</span>
                    <AgentaMark
                        className="auth-404-mark"
                        markClassName="fill-current"
                        aria-hidden
                    />
                    <span aria-hidden>4</span>
                </div>

                <h1 className="auth-headline auth-headline-form mt-4">This page isn&apos;t here</h1>
                <p className="auth-subline mt-2 max-w-[440px]">
                    This link doesn&apos;t point anywhere. Go back to where you were, or report it
                    if you think it should work.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {onBack ? (
                        <button
                            type="button"
                            className="auth-btn-yellow auth-btn-auto"
                            onClick={onBack}
                        >
                            Go back
                        </button>
                    ) : null}
                    <a className="auth-surface-btn auth-btn-auto" href={ISSUES_URL}>
                        Report
                    </a>
                </div>
            </div>

            {/* The technical half, last and quietest: useful in a bug report, noise to everyone else. */}
            <p className="auth-404-code px-6 pb-10 text-center">
                Error 404
                {mounted && path ? (
                    <>
                        {" · "}
                        {/* Monospaced so an l is tellable from a 1 when retyping the address. */}
                        <span className="font-mono">{path}</span>
                    </>
                ) : null}
            </p>
        </main>
    )
}
