import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {BackLink} from "@agenta/ui/ui"
import Link from "next/link"

/**
 * Back up one level.
 *
 * The only back affordance in this app: every other screen is a top-level nav destination
 * reachable from the drawer, and these are drill-downs into a row.
 *
 * The label names the DESTINATION, not the link — from a run history that is the automation you
 * came from, and a second "Automations" there would skip a level the reader can see they are on.
 *
 * `onBack` instead of `href` where the destination is another VIEW of the same screen (the run
 * history returning to the config), so going back does not touch the URL.
 */
export const AutomationBackLink = ({
    href,
    onBack,
    label,
}: {
    href?: string
    /** In-page return. Takes precedence over `href`. */
    onBack?: () => void
    label?: string
}) => {
    const t = useT(automationsEditorCatalog)
    const text = label ?? t("automations.editor.backToAutomations")
    return onBack ? (
        <BackLink onClick={onBack}>
            <span className="truncate">{text}</span>
        </BackLink>
    ) : (
        <BackLink asChild>
            <Link href={href ?? ""}>
                <span className="truncate">{text}</span>
            </Link>
        </BackLink>
    )
}
