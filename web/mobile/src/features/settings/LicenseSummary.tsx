import {useT, type CatalogKey} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {Badge, type BadgeProps} from "@agenta/ui/ui"

import {formatDate} from "../wallet/walletFormat"

import type {InstanceLicense, LicenseLimitUsage} from "./licenseApi"
import {LicenseUsageRow} from "./LicenseUsageRow"

type LicenseKey = CatalogKey<typeof settingsLicenseCatalog>

const REGISTERED_PLAN = "self_hosted_registered"

/** The plan name and its badge. The free key keeps the Community name, as a registered badge. */
const PLANS: Record<string, {name: LicenseKey; badge: LicenseKey; variant: BadgeProps["variant"]}> =
    {
        self_hosted_community: {
            name: "settings.license.planCommunity",
            badge: "settings.license.badgeFree",
            variant: "default",
        },
        [REGISTERED_PLAN]: {
            name: "settings.license.planCommunity",
            badge: "settings.license.badgeRegistered",
            variant: "success",
        },
        self_hosted_enterprise: {
            name: "settings.license.planEnterprise",
            badge: "settings.license.badgeActive",
            variant: "success",
        },
    }

const DAY_MS = 24 * 60 * 60 * 1000

/** The instance plan in one line, its usage against the limits, and the key behind it. */
export const LicenseSummary = ({
    license,
    now = Date.now(),
}: {
    license: InstanceLicense
    now?: number
}) => {
    const t = useT(settingsLicenseCatalog)
    const key = license.license
    const {users, projects, organizations} = license.usage
    const expiresAt = key?.expires_at ? new Date(key.expires_at).getTime() : null
    const expired = expiresAt !== null && expiresAt <= now
    const plan = PLANS[license.plan]
    const registered = license.plan === REGISTERED_PLAN

    const usage = (label: LicenseKey, value: LicenseLimitUsage) => (
        <LicenseUsageRow
            label={t(label)}
            value={
                value.limit === null
                    ? t("settings.license.usageOfUnlimited", {count: value.count})
                    : t("settings.license.usageOf", {count: value.count, limit: value.limit})
            }
            count={value.count}
            limit={value.limit}
        />
    )

    return (
        <section className="bg-card ring-border flex flex-col gap-3 rounded-2xl px-5 py-[18px] ring-1 ring-inset">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-foreground m-0 text-xl font-semibold leading-7 tracking-[-0.01em]">
                    {plan ? t(plan.name) : license.plan}
                </h3>
                {expired ? (
                    <Badge variant="error">{t("settings.license.expired")}</Badge>
                ) : plan ? (
                    <Badge variant={plan.variant}>{t(plan.badge)}</Badge>
                ) : null}
            </div>
            {!key ? (
                <p className="text-muted-foreground m-0 text-[13px]">
                    {t("settings.license.communitySummary")}
                </p>
            ) : registered ? (
                <p className="text-muted-foreground m-0 text-[13px]">
                    {t("settings.license.registeredSummary", {email: key.customer})}
                </p>
            ) : null}
            <div className="flex flex-col gap-2.5">
                {key && !registered ? (
                    <LicenseUsageRow
                        label={t("settings.license.licensedTo")}
                        value={key.customer}
                    />
                ) : null}
                {projects ? usage("settings.license.usageProjects", projects) : null}
                {organizations ? usage("settings.license.usageOrganizations", organizations) : null}
                {key && key.seats !== null ? (
                    <LicenseUsageRow
                        label={t("settings.license.seats")}
                        value={t("settings.license.usageOf", {count: users, limit: key.seats})}
                        count={users}
                        limit={key.seats}
                    />
                ) : (
                    <LicenseUsageRow label={t("settings.license.users")} value={String(users)} />
                )}
                {key ? (
                    <LicenseUsageRow
                        label={t(
                            registered
                                ? "settings.license.keyExpires"
                                : expired
                                  ? "settings.license.expired"
                                  : "settings.license.expires",
                        )}
                        value={
                            !key.expires_at || expiresAt === null
                                ? t("settings.license.never")
                                : expired
                                  ? formatDate(key.expires_at)
                                  : t("settings.license.expiresIn", {
                                        date: formatDate(key.expires_at),
                                        count: Math.ceil((expiresAt - now) / DAY_MS),
                                    })
                        }
                    />
                ) : null}
            </div>
        </section>
    )
}
