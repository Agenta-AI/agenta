import {AccessUpgradeNotice} from "@agenta/settings-ui"

import {UpgradeActions} from "./UpgradeActions"
import {upgradeAvailability, useUpgradePrompt} from "./upgradePrompt"

/** One Access & Security feature the self-hosted plan does not include, with its upgrade actions. */
export const LockedAccessFeature = ({
    feature,
    projectId,
}: {
    feature: "access" | "domains" | "sso"
    projectId: string
}) => {
    const prompt = useUpgradePrompt({feature, screen: "organization", projectId, shown: true})
    return (
        <AccessUpgradeNotice
            locked={[feature]}
            availability={upgradeAvailability(prompt)}
            action={
                <UpgradeActions feature={feature} screen="organization" actions={prompt.actions} />
            }
        />
    )
}
