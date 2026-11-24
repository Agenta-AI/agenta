import {useT} from "@agenta/i18n"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import {BackLink} from "@agenta/ui/ui"
import Link from "next/link"

/** Where Back goes: the parent page's link, or an in-page return (another view of this page). */
export type PageBack = {
    /** The parent's name: "Automations", not "Back". */
    label: string
} & ({href: string; onBack?: never} | {onBack: () => void; href?: never})

/** An inside page's Back: the kit's back link on the parent's route, or a button for `onBack`. */
export const PageBackControl = ({
    back,
    size,
    className,
}: {
    back: PageBack
    size?: "default" | "bar"
    className?: string
}) => {
    const t = useT(phoneCatalog)
    // The visible text names the parent; the accessible name says it goes back there.
    const name = t("ui.phone.backTo", {title: back.label})
    return back.onBack ? (
        <BackLink size={size} className={className} onClick={back.onBack} aria-label={name}>
            <span className="truncate">{back.label}</span>
        </BackLink>
    ) : (
        <BackLink asChild size={size} className={className}>
            <Link href={back.href} aria-label={name}>
                <span className="truncate">{back.label}</span>
            </Link>
        </BackLink>
    )
}
