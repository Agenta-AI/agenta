import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"
import {Button} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import type {InstanceLimitUsage} from "../settings/licenseApi"
import {LicenseUsageRow, useLimitUsageText} from "../settings/LicenseUsageRow"
import {CONTACT_URL} from "../settings/upgradePrompt"
import {useInstanceLicense} from "../settings/useInstanceLicense"

/**
 * The organization limit, shown when the dialog opens. A free key does not lift it, so the next
 * steps are an Enterprise license or an invitation to an organization that exists.
 */
export const OrganizationLimitNotice = ({
    usage,
    workspaceId,
    projectId,
    onNavigate,
}: {
    usage: InstanceLimitUsage
    workspaceId: string
    projectId: string
    /** Called before "Add a license key" opens Settings, so the dialog can close. */
    onNavigate?: () => void
}) => {
    const t = useT(limitRefusalCatalog, settingsLicenseCatalog)
    const usageText = useLimitUsageText()
    const router = useRouter()
    const {isInstanceAdmin} = useInstanceLicense(projectId)

    return (
        <div
            role="status"
            className="bg-colorInfoBg ring-colorInfoBorder flex flex-col gap-2.5 rounded-xl px-3.5 py-3 ring-1 ring-inset"
        >
            <LicenseUsageRow
                label={t("settings.license.usageOrganizations")}
                value={usageText("organizations", usage)}
                count={usage.count}
                limit={usage.limit}
            />
            <p className="text-foreground m-0 text-[13px]">
                {t("shell.limitRefusal.organizationLimitInfo")}
            </p>
            <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                    <a
                        href={`${CONTACT_URL}?feature=organizations`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {t("settings.license.actionTalkToUs")}
                    </a>
                </Button>
                {isInstanceAdmin ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            onNavigate?.()
                            void router.push(
                                `/w/${workspaceId}/p/${projectId}/settings?tab=license`,
                            )
                        }}
                    >
                        {t("settings.license.actionAddLicenseKey")}
                    </Button>
                ) : null}
            </div>
        </div>
    )
}
