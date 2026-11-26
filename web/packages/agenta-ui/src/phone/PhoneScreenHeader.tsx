import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import {CaretLeft} from "@phosphor-icons/react"

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
    /** Controls at the right end of the row (icon buttons of 44 px). */
    trailing?: ReactNode
    /** The title stays for screen readers only: the back arrow and the content say where you are. */
    hideTitle?: boolean
    className?: string
}

/**
 * The top row of a full screen view on a phone: the back arrow with the name of the screen
 * before, the title, and optional controls at the right. The back arrow has a 44 px hit area.
 */
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
                "flex h-13 min-w-0 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted bg-background px-1",
                className,
            )}
        >
            {onBack ? (
                <button
                    type="button"
                    aria-label={
                        backLabel ??
                        (backTitle ? t("ui.phone.backTo", {title: backTitle}) : t("ui.phone.back"))
                    }
                    className=" box-border flex h-8 min-w-8 max-w-[130px] shrink-0 cursor-pointer items-center gap-0.5 rounded-md border-0 bg-transparent py-0 pl-0.5 pr-1.5 font-[inherit] text-label leading-5 text-muted-foreground active:bg-secondary"
                    onClick={onBack}
                >
                    <CaretLeft size={16} aria-hidden className="shrink-0" />
                    {backTitle ? <span className="truncate">{backTitle}</span> : null}
                </button>
            ) : null}
            <h1
                className={cn(
                    "m-0 min-w-0 truncate text-title text-foreground",
                    onBack ? "pr-1.5" : "px-3",
                    hideTitle && "sr-only",
                )}
            >
                {title}
            </h1>
            <div className="min-w-0 flex-1" />
            {trailing ? <div className="flex shrink-0 items-center">{trailing}</div> : null}
        </div>
    )
}
