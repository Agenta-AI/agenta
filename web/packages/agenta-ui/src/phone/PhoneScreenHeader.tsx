import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"

import {BackLink} from "../components/ui/back-link"
import {cn} from "../utils/styles"

export interface PhoneScreenHeaderProps {
    /** The title of the screen. Cut with an ellipsis when it is longer than the row. */
    title: ReactNode
    /**
     * Goes back one screen. Without it the header shows no back arrow (the root of a container
     * that has its own way out).
     */
    onBack?: () => void
    /**
     * The name of the screen the back arrow returns to, shown beside the arrow ("Session") and
     * read as "Back to Session". Without it the arrow shows alone and reads "Back".
     */
    backTitle?: string
    /** The back arrow's accessible name when "Back to {backTitle}" does not read well. */
    backLabel?: string
    /** Controls at the right end of the row (the kit's compact icon buttons). */
    trailing?: ReactNode
    /** The title stays for screen readers only: the back arrow and the content say where you are. */
    hideTitle?: boolean
    className?: string
}

/** The top bar of a full screen view on a phone: one 44px bar, the kit Back, the title, trailing controls (COMPACT-02). */
export const PhoneScreenHeader = ({
    title,
    onBack,
    backTitle,
    backLabel,
    trailing,
    hideTitle = false,
    className,
}: PhoneScreenHeaderProps) => {
    const t = useT(phoneCatalog)
    return (
        <div
            data-testid="phone-screen-header"
            className={cn(
                "box-border flex h-header min-w-0 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted bg-background px-4",
                className,
            )}
        >
            {onBack ? (
                <BackLink
                    size="bar"
                    aria-label={
                        backLabel ??
                        (backTitle ? t("ui.phone.backTo", {title: backTitle}) : t("ui.phone.back"))
                    }
                    // The screen before gets up to 60% of the row, the title the rest.
                    className="max-w-[60%] shrink-0"
                    onClick={onBack}
                >
                    {backTitle ? <span className="min-w-0 truncate">{backTitle}</span> : null}
                </BackLink>
            ) : null}
            <h1
                className={cn(
                    "m-0 min-w-0 truncate text-title text-foreground",
                    hideTitle && "sr-only",
                )}
            >
                {title}
            </h1>
            <div className="min-w-0 flex-1" />
            {/* -6px: the trailing glyph sits on the 16px line. */}
            {trailing ? <div className="-mr-1.5 flex shrink-0 items-center">{trailing}</div> : null}
        </div>
    )
}
