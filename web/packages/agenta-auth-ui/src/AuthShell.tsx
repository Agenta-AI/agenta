/** The sign-in frame: the method column beside the product panel, which hides below `lg`. */
import type {ReactNode} from "react"

import AuthSideBanner from "./AuthSideBanner"

export interface AuthShellProps {
    /** The logo, dropped into the column's top-left corner. */
    header?: ReactNode
    /** Extra classes on the logo strip. */
    headerClassName?: string
    /** The method column's content: heading block, buttons, forms. Capped at 400px. */
    children: ReactNode
    /** Optional deploy-time display font; loads "Agenta Display" and switches the headline treatment. */
    displayFontUrl?: string
    /** Defaults to the product panel. Pass `null` for a bare column. */
    banner?: ReactNode
    /** Anything floating over the frame — hosts put their toast here. */
    overlay?: ReactNode
    /** Plays the exit (fade and slight shrink) once a sign-in has succeeded. */
    leaving?: boolean
}

/**
 * Percent-encode the characters that could close the `url("...")` and inject CSS. The value is a
 * deploy-time env var, but it reaches a raw <style> tag, so it is escaped rather than trusted.
 */
const cssUrl = (url: string) => encodeURI(url).replace(/[()"'\\]/g, encodeURIComponent)

export const AuthShell = ({
    header,
    headerClassName,
    children,
    displayFontUrl,
    banner,
    overlay,
    leaving = false,
}: AuthShellProps) => (
    <main
        className={`auth-redesign auth-shell flex min-h-dvh w-full bg-background text-foreground lg:h-screen lg:overflow-hidden ${leaving ? "auth-shell-leaving" : ""}`}
        data-display-font={displayFontUrl ? "serif" : undefined}
    >
        {displayFontUrl && (
            <style>{`@font-face{font-family:"Agenta Display";src:url("${cssUrl(displayFontUrl)}");font-weight:300;font-display:swap;}`}</style>
        )}
        <section className="relative z-[1] flex w-full flex-col overflow-y-auto [scrollbar-width:none] lg:w-1/2 lg:shrink-0">
            {header ? (
                <div className={`absolute left-0 top-0 px-6 pt-7 sm:px-9 ${headerClassName ?? ""}`}>
                    {header}
                </div>
            ) : null}
            <div className="flex flex-1 items-center justify-center px-[clamp(24px,4vw,48px)] py-[88px]">
                <div className="flex w-full max-w-[400px] flex-col gap-[22px]">{children}</div>
            </div>
        </section>
        {banner === undefined ? <AuthSideBanner /> : banner}
        {overlay}
    </main>
)
