import {Button} from "@agenta/ui/ui"
import Link from "next/link"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"

/**
 * "Overview" beside an app picker: a link to that app's overview. It shows only for a picked app
 * while the overview view is on. It does not prefetch: the overview must not load until opened.
 */
export const AppOverviewLink = ({base, appId}: {base: string; appId: string | null}) => {
    const enabled = useDeveloperViewEnabled("app-overview") === true
    if (!enabled || !appId) return null
    return (
        <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`${base}/apps/${encodeURIComponent(appId)}/overview`} prefetch={false}>
                Overview
            </Link>
        </Button>
    )
}
