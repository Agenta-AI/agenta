import {useT, type CatalogKey} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {Button} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import {
    captureUpgradeClick,
    contactUrl,
    type UpgradeAction,
    type UpgradeFeature,
    type UpgradeScreen,
} from "./upgradePrompt"

const LABELS: Record<UpgradeAction, CatalogKey<typeof settingsLicenseCatalog>> = {
    get_free_key: "settings.license.actionGetFreeKey",
    add_license_key: "settings.license.actionAddLicenseKey",
    talk_to_us: "settings.license.actionTalkToUs",
}

/** The buttons of a locked section on a self-hosted instance; each click is an upgrade event. */
export const UpgradeActions = ({
    feature,
    screen,
    actions,
}: {
    feature: UpgradeFeature
    screen: UpgradeScreen
    actions: UpgradeAction[]
}) => {
    const t = useT(settingsLicenseCatalog)
    const router = useRouter()
    const openLicense = () =>
        void router.replace({query: {...router.query, tab: "license"}}, undefined, {
            shallow: true,
        })

    return (
        <div className="flex flex-wrap justify-center gap-2">
            {actions.map((action, index) => {
                const variant = index === 0 ? "default" : "outline"
                const onClick = () => captureUpgradeClick(feature, screen, action)
                if (action === "get_free_key" || action === "add_license_key") {
                    return (
                        <Button
                            key={action}
                            size="sm"
                            variant={variant}
                            onClick={() => {
                                onClick()
                                openLicense()
                            }}
                        >
                            {t(LABELS[action])}
                        </Button>
                    )
                }
                return (
                    <Button key={action} asChild size="sm" variant={variant}>
                        <a
                            href={contactUrl(feature)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={onClick}
                        >
                            {t(LABELS[action])}
                        </a>
                    </Button>
                )
            })}
        </div>
    )
}
