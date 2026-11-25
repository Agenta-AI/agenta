import {richText, useT, type CatalogKey} from "@agenta/i18n"
import settingsAccessCatalog from "@agenta/i18n/catalogs/settings.access"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {isEE} from "@agenta/shared/api"
import {Badge} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"

import {UpgradeActions} from "./UpgradeActions"
import {
    availableUpgradeActions,
    useUpgradePromptViewed,
    type UpgradeFeature,
    type UpgradeScreen,
} from "./upgradePrompt"

type LicenseKey = CatalogKey<typeof settingsLicenseCatalog>

const ORDER: UpgradeFeature[] = ["access", "domains", "sso", "audit"]

const LINES: Record<UpgradeFeature, LicenseKey> = {
    access: "settings.license.lockedAccess",
    domains: "settings.license.lockedDomains",
    sso: "settings.license.lockedSso",
    audit: "settings.license.lockedAudit",
}

/** The read-only preview row under the box; the audit log has none. */
const ROWS: Partial<
    Record<UpgradeFeature, {name: CatalogKey<typeof settingsAccessCatalog>; line: LicenseKey}>
> = {
    access: {name: "settings.access.accessControls", line: "settings.license.lockedAccessRow"},
    domains: {name: "settings.access.verifiedDomains", line: "settings.license.lockedDomainsRow"},
    sso: {name: "settings.access.ssoProviders", line: "settings.license.lockedSsoRow"},
}

/**
 * The self-hosted locked state of a settings page: one box that names each feature the plan
 * does not include, the upgrade actions, then each feature's setting as a read-only row.
 * It calls none of the routes the features stand for.
 */
export const LockedEnterpriseFeatures = ({
    features,
    screen,
}: {
    features: UpgradeFeature[]
    screen: UpgradeScreen
}) => {
    const t = useT(settingsLicenseCatalog, settingsAccessCatalog)
    const present = ORDER.filter((feature) => features.includes(feature))
    useUpgradePromptViewed(present, screen)
    if (present.length === 0) return null
    const strong = {strong: (text: string) => <strong className="font-medium">{text}</strong>}
    const rows = present.flatMap((feature) => {
        const row = ROWS[feature]
        return row ? [{feature, ...row}] : []
    })

    return (
        <div className="flex flex-col gap-5">
            <section className="bg-card ring-border flex flex-col gap-3 rounded-2xl px-5 py-[18px] ring-1 ring-inset">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">{t("settings.license.lockedBadge")}</Badge>
                    <h3 className="text-foreground m-0 text-sm font-semibold">
                        {t("settings.license.lockedTitle")}
                    </h3>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {present.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-[13px]">
                            <Check
                                size={14}
                                weight="bold"
                                className="text-success mt-[3px] shrink-0"
                            />
                            <span>{richText(t(LINES[feature]), strong)}</span>
                        </li>
                    ))}
                </ul>
                <UpgradeActions
                    feature={present[0]}
                    screen={screen}
                    actions={availableUpgradeActions(isEE())}
                />
            </section>
            {rows.map((row) => (
                <section key={row.feature} aria-disabled className="flex flex-col gap-1 opacity-70">
                    <div className="flex items-center gap-2">
                        <h3 className="text-foreground m-0 text-sm font-semibold">{t(row.name)}</h3>
                        <Badge variant="info">{t("settings.license.lockedBadge")}</Badge>
                    </div>
                    <p className="text-muted-foreground m-0 text-[13px]">{t(row.line)}</p>
                </section>
            ))}
        </div>
    )
}
