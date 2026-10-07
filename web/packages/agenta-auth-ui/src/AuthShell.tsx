/**
 * The sign-in page frame — the outer composition every host renders its methods inside.
 *
 * A white method column (logo in its corner, the flow capped at 400px) beside the dotted product
 * panel, which hides itself below `lg` so the same markup is the phone screen.
 *
 * The logo strip is positioned, not stacked, so the form's top edge does not move with it.
 */
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
        className={`auth-redesign auth-shell flex min-h-dvh w-full lg:h-screen lg:overflow-hidden ${leaving ? "auth-shell-leaving" : ""}`}
        data-display-font={displayFontUrl ? "serif" : undefined}
    >
        {displayFontUrl && (
            <style>{`@font-face{font-family:"Agenta Display";src:url("${cssUrl(displayFontUrl)}");font-weight:300;font-display:swap;}`}</style>
        )}
        <section className="relative z-[1] flex w-full flex-col overflow-y-auto [scrollbar-width:none] lg:w-[min(560px,46%)] lg:shrink-0">
            {header ? (
                <div className={`absolute left-0 top-0 px-6 pt-7 sm:px-9 ${headerClassName ?? ""}`}>
                    {header}
                </div>
            ) : null}
            <div className="flex flex-1 justify-center px-[clamp(24px,4vw,48px)] pb-24 pt-[clamp(88px,16vh,160px)]">
                <div className="flex w-full max-w-[400px] flex-col gap-[22px]">{children}</div>
            </div>
        </section>
        {banner === undefined ? <AuthSideBanner /> : banner}
        {overlay}
    </main>
)
