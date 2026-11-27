import {useT} from "@agenta/i18n"
import uiStatusCatalog from "@agenta/i18n/catalogs/ui.status"
import {timeAgo} from "@agenta/shared/utils"

export interface BylineTextProps {
    /** Who made the last change. */
    name: string
    /** When, as an ISO date: `updated_at`, else `created_at`. */
    at: string
    /** The current user: "By you" in place of the name. */
    isYou?: boolean
}

/** "By NAME, TIME" or "By you, TIME", with a coarse relative time. Nothing for a bad date. */
export function BylineText({name, at, isYou = false}: BylineTextProps) {
    const t = useT(uiStatusCatalog)
    const time = timeAgo(Date.parse(at))
    if (!time) return null
    return <>{isYou ? t("ui.status.byYouAt", {time}) : t("ui.status.byNameAt", {name, time})}</>
}
