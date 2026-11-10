import {AccessUpgradeNotice, type AccessFeature} from "@agenta/settings-ui"

import {UpgradeActions} from "./UpgradeActions"
import {SELF_HOSTED_AVAILABILITY, useUpgradePrompt} from "./upgradePrompt"

/** One Access & Security feature the self-hosted plan does not include, with its upgrade actions. */
export const LockedAccessFeature = ({feature}: {feature: AccessFeature}) => {
    const prompt = useUpgradePrompt({feature, screen: "organization", shown: true})
    return (
        <AccessUpgradeNotice
            locked={[feature]}
            availability={SELF_HOSTED_AVAILABILITY}
            action={
                <UpgradeActions feature={feature} screen="organization" actions={prompt.actions} />
            }
        />
    )
}
