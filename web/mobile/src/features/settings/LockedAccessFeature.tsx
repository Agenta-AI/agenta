import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {AccessUpgradeNotice, type AccessFeature} from "@agenta/settings-ui"

import {UpgradeActions} from "./UpgradeActions"
import {useUpgradePrompt} from "./upgradePrompt"

/** One Access & Security feature the self-hosted plan does not include, with its upgrade actions. */
export const LockedAccessFeature = ({feature}: {feature: AccessFeature}) => {
    const t = useT(settingsLicenseCatalog)
    const prompt = useUpgradePrompt({feature, screen: "organization", shown: true})
    return (
        <AccessUpgradeNotice
            locked={[feature]}
            availability={t("settings.license.availableWithEnterprise")}
            action={
                <UpgradeActions feature={feature} screen="organization" actions={prompt.actions} />
            }
        />
    )
}
