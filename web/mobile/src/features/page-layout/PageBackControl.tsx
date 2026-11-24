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
}) =>
    back.onBack ? (
        <BackLink size={size} className={className} onClick={back.onBack}>
            <span className="truncate">{back.label}</span>
        </BackLink>
    ) : (
        <BackLink asChild size={size} className={className}>
            <Link href={back.href}>
                <span className="truncate">{back.label}</span>
            </Link>
        </BackLink>
    )
