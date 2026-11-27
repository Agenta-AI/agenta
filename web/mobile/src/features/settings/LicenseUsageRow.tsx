import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"

import type {InstanceLimitUsage} from "./licenseApi"

/**
 * The value text of a project or organization limit row: "N of unlimited", "N of M", or, for an
 * upgraded install already over the limit, "N projects, limit M". The License tab and the limit
 * dialogs share it, so they say the same thing.
 */
export const useLimitUsageText = () => {
    const t = useT(settingsLicenseCatalog)
    return (kind: "projects" | "organizations", usage: InstanceLimitUsage): string => {
        const {count, limit} = usage
        if (limit === null) return t("settings.license.usageOfUnlimited", {count})
        if (count <= limit) return t("settings.license.usageOf", {count, limit})
        return kind === "projects"
            ? t("settings.license.usageOverLimitProjects", {count, limit})
            : t("settings.license.usageOverLimitOrganizations", {count, limit})
    }
}

/** One plan row: a label and a value, with a bar when the value is a count against a limit. */
export const LicenseUsageRow = ({
    label,
    value,
    count,
    limit,
}: {
    label: string
    value: string
    count?: number
    /** `null` or unset: unlimited, so no bar. */
    limit?: number | null
}) => {
    const bar = count !== undefined && typeof limit === "number" && limit > 0
    const percent = bar ? Math.min(100, Math.round((count / limit) * 100)) : 0
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-body-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-foreground truncate text-right tabular-nums">{value}</span>
            </div>
            {bar ? (
                <div
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={limit}
                    aria-valuenow={count}
                    className="bg-muted h-1.5 overflow-hidden rounded-round"
                >
                    <div className="bg-info h-full rounded-round" style={{width: `${percent}%`}} />
                </div>
            ) : null}
        </div>
    )
}
