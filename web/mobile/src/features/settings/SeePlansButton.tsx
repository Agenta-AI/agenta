import {useT} from "@agenta/i18n"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import {Button} from "@agenta/ui/ui"
import Link from "next/link"

import {billingUrl} from "@/lib/context"

/** The upgrade action on a plan-locked settings tab: Plan & billing with the chooser open. */
export const SeePlansButton = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const t = useT(settingsSharedCatalog)
    return (
        <Button asChild size="sm">
            <Link href={`${billingUrl({workspaceId, projectId})}&plans=1`} prefetch={false}>
                {t("settings.shared.seePlans")}
            </Link>
        </Button>
    )
}
