import {FC} from "react"

import {isBillingEnabled} from "@agenta/shared/api"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {appIdentifiersAtom} from "@/oss/state/appState/atoms"

/**
 * The "Upgrade plan →" link for a locked section.
 *
 * Only the link lives here: the panel around it is `AccessUpgradeNotice` in
 * `@agenta/settings-ui`, which renders ONE card for however many of the three features the
 * plan excludes. Routing and billing availability stay in the app, which is why the package
 * takes this as a slot rather than building the href itself.
 */
export const UpgradePlanLink: FC = () => {
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    if (!isBillingEnabled() || !workspaceId || !projectId) return null

    return (
        <Link
            href={`/w/${workspaceId}/p/${projectId}/settings?tab=billing&upgrade=true`}
            className="font-medium"
        >
            Upgrade plan →
        </Link>
    )
}

export default UpgradePlanLink
