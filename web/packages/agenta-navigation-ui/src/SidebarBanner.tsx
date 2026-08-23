import {memo} from "react"

import type {BannerConfig} from "@agenta/navigation"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {X} from "@phosphor-icons/react"
import {useRouter} from "next/router"

interface SidebarBannerProps {
    banner: BannerConfig
    onDismiss?: () => void
}

// The rail ground is warm, so the card needs its own surface + the shell hairline to read as a card.
// px-[11px] = 12px nav-item padding − the 1px card border, so the text starts on the nav icon column.
const bannerClassName =
    "px-[11px] py-3 rounded-lg flex flex-col gap-2 relative bg-colorBgElevated border border-solid border-[var(--ag-shell-line)]"

// Semantic fill, not black/5: a 5% black wash is invisible on the dark elevated surface.
const dismissClassName =
    "absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-colorText transition-colors hover:bg-colorFillTertiary focus:outline-none focus-visible:bg-colorFillTertiary focus-visible:outline-none"

const SidebarBanner = ({banner, onDismiss}: SidebarBannerProps) => {
    const router = useRouter()

    const handleActionClick = () => {
        if (banner.action?.onClick) {
            banner.action.onClick()
        } else if (banner.action?.href) {
            if (banner.action.href.startsWith("http")) {
                window.open(banner.action.href, "_blank")
            } else {
                router.push(banner.action.href)
            }
        }
    }

    // If custom content is provided, render it instead
    if (banner.customContent) {
        return (
            <section className={bannerClassName}>
                {banner.dismissible && onDismiss && (
                    <button
                        onClick={onDismiss}
                        className={dismissClassName}
                        aria-label="Dismiss banner"
                    >
                        <X size={16} />
                    </button>
                )}
                {banner.customContent}
            </section>
        )
    }

    return (
        <section className={bannerClassName}>
            {banner.dismissible && onDismiss && (
                <button
                    onClick={onDismiss}
                    className={dismissClassName}
                    aria-label="Dismiss banner"
                >
                    <X size={16} />
                </button>
            )}
            <span className="text-sm leading-5 font-semibold pr-10 text-colorText">
                {banner.title}
            </span>
            <span className="text-[12px] leading-5 text-[var(--ag-c-586673)]">
                {banner.description}
            </span>
            {banner.action && (
                <EnhancedButton onClick={handleActionClick} className="self-start" size="small">
                    {banner.action.label}
                </EnhancedButton>
            )}
        </section>
    )
}

export default memo(SidebarBanner)
