/**
 * The 404 page: the same full-screen surface in oss, ee and mobile.
 *
 * It sits beside `AuthShell` because it is the other surface a signed-out visitor lands on, and
 * it uses the same primitives and theme tokens. Routing arrives as a prop; the package has no
 * router of its own.
 */
import {useEffect, useState} from "react"

import {Button} from "@agenta/ui/ui"

import {AgentaMark, AgentaWordmark} from "./AgentaBrand"
import {HEADLINE_CLASS, KEYCAP_CLASS, SUBLINE_CLASS} from "./classes"

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
        <main className="auth-redesign relative flex min-h-dvh w-full flex-col bg-background text-foreground">
            <div className="px-9 pt-7">
                {/* 104x23 keeps the SVG's 361:80 ratio at the sign-in page's brand height. */}
                <AgentaWordmark width={104} height={23} markClassName="fill-current" />
            </div>

            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                {/* The mark stands in for the middle zero, sized to the numerals' cap height. */}
                <div
                    className="flex items-center justify-center text-[clamp(96px,15vw,196px)] font-black leading-none tracking-[-0.04em]"
                    role="img"
                    aria-label="404"
                >
                    <span aria-hidden>4</span>
                    <AgentaMark
                        className="-mx-[0.04em] h-[0.7em] w-auto flex-none"
                        markClassName="fill-current"
                        aria-hidden
                    />
                    <span aria-hidden>4</span>
                </div>

                <h1 className={`${HEADLINE_CLASS} mt-4`}>This page isn&apos;t here</h1>
                <p className={`${SUBLINE_CLASS} mt-2 max-w-[440px]`}>
                    This link doesn&apos;t point anywhere. Go back to where you were, or report it
                    if you think it should work.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {onBack ? (
                        <Button type="button" size="lg" className={`${KEYCAP_CLASS} w-auto px-5`} onClick={onBack}>
                            Go back
                        </Button>
                    ) : null}
                    <Button asChild variant="outline" size="lg" className="h-11 rounded-lg px-5 text-sm font-medium">
                        <a href={ISSUES_URL}>Report</a>
                    </Button>
                </div>
            </div>

            {/* Quietest text on the page: it is here to be quoted into a bug report. */}
            <p className="px-6 pb-10 text-center text-xs leading-[18px] text-[color:var(--ag-colorTextQuaternary)]">
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
