/**
 * The 404 page: the same full-screen surface in oss, ee and mobile.
 *
 * It sits beside `AuthShell` because it is the other surface a signed-out visitor lands on,
 * and it is built from the same scoped auth.css tokens. Plain elements only, like the rest of
 * this package, so it renders the same inside antd and inside shadcn. Routing arrives as a
 * prop; the package has no router of its own.
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
    // Next prerenders /404 with `asPath` as the literal "/404", so the real address is
    // client-only or it hydrates against different text.
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

            {/* Quietest text on the page: it is here to be quoted into a bug report. */}
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
