import {useT, type CatalogKey} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"

import {formatDate} from "../wallet/walletFormat"

import type {InstanceLicense} from "./licenseApi"

const PLAN_NAMES: Record<string, CatalogKey<typeof settingsLicenseCatalog>> = {
    self_hosted_community: "settings.license.planCommunity",
    self_hosted_registered: "settings.license.planRegistered",
    self_hosted_enterprise: "settings.license.planEnterprise",
}

const Row = ({label, value}: {label: string; value: string}) => (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground truncate text-right">{value}</span>
    </div>
)

/** The instance plan, and the key behind it: customer, seats, expiry. */
export const LicenseSummary = ({license}: {license: InstanceLicense}) => {
    const t = useT(settingsLicenseCatalog)
    const key = license.license
    const users = license.usage.users
    const expired = Boolean(key?.expires_at && new Date(key.expires_at) <= new Date())

    return (
        <section className="bg-card ring-border flex flex-col gap-2.5 rounded-2xl px-5 py-[18px] ring-1 ring-inset">
            <span className="text-muted-foreground text-[13px]">{t("settings.license.plan")}</span>
            <span className="text-[26px] font-semibold leading-8 tracking-[-0.02em]">
                {PLAN_NAMES[license.plan] ? t(PLAN_NAMES[license.plan]) : license.plan}
            </span>
            {key ? (
                <div className="flex flex-col gap-1.5 pt-1">
                    <Row label={t("settings.license.licensedTo")} value={key.customer} />
                    <Row
                        label={t("settings.license.seats")}
                        value={
                            key.seats === null
                                ? t("settings.license.seatsUsed", {users})
                                : t("settings.license.seatsUsedOf", {users, seats: key.seats})
                        }
                    />
                    <Row
                        label={t(expired ? "settings.license.expired" : "settings.license.expires")}
                        value={
                            key.expires_at
                                ? formatDate(key.expires_at)
                                : t("settings.license.never")
                        }
                    />
                </div>
            ) : (
                <Row label={t("settings.license.users")} value={String(users)} />
            )}
        </section>
    )
}
