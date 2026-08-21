/**
 * The sign-in page frame — the outer composition every host renders its methods inside.
 *
 * One column of methods (560px from `lg`) beside the marketing panel, which hides itself on
 * narrow viewports so the same markup is the phone screen. Extracted from the OSS auth page so
 * oss, ee and mobile share one layout instead of three that drift.
 *
 * The logo strip is positioned, not stacked: stacking it pushes the form down by its height and
 * the column reads as bottom-heavy. Out of flow, the form centers on the viewport and the logo
 * still sits in the top-left corner.
 */
import type {ReactNode} from "react"

import AuthSideBanner from "./AuthSideBanner"

export interface AuthShellProps {
    /** The logo, dropped into the column's top-left corner. */
    header?: ReactNode
    /** Extra classes on the logo strip — hosts that only want it from `lg` pass `hidden lg:block`. */
    headerClassName?: string
    /** The method column's content: heading block, buttons, forms. Capped at 400px. */
    children: ReactNode
    /** Optional deploy-time display font; loads "Agenta Display" and switches the headline treatment. */
    displayFontUrl?: string
    /** Defaults to the marketing panel. Pass `null` for a bare column. */
    banner?: ReactNode
    /** Anything floating over the frame — hosts put their toast here. */
    overlay?: ReactNode
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
}: AuthShellProps) => (
    <main
        className="auth-redesign flex min-h-dvh w-full items-stretch justify-center gap-3 p-3 lg:h-screen lg:overflow-hidden"
        data-display-font={displayFontUrl ? "serif" : undefined}
    >
        {displayFontUrl && (
            <style>{`@font-face{font-family:"Agenta Display";src:url("${cssUrl(displayFontUrl)}");font-weight:300;font-display:swap;}`}</style>
        )}
        <section className="relative flex w-full flex-col overflow-y-auto lg:w-[560px] lg:shrink-0">
            {header ? (
                <div className={`absolute left-0 top-0 px-9 pt-7 ${headerClassName ?? ""}`}>
                    {header}
                </div>
            ) : null}
            <div className="flex flex-1 items-center justify-center px-4 py-16">
                <div className="flex w-full max-w-[400px] flex-col gap-[22px]">{children}</div>
            </div>
        </section>
        {banner === undefined ? <AuthSideBanner /> : banner}
        {overlay}
    </main>
)
