import {useState} from "react"

import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"
import {Button} from "@agenta/ui/ui"

import type {InstanceLimitUsage} from "../settings/licenseApi"
import {LicenseUsageRow, useLimitUsageText} from "../settings/LicenseUsageRow"
import {useInstanceLicense} from "../settings/useInstanceLicense"

import {RegistrationDialog} from "./RegistrationDialog"

/**
 * The project limit, shown when the create dialog opens: the usage, and the next step. The
 * instance admin registers the instance in place; a member asks the instance admin.
 */
export const ProjectLimitNotice = ({
    usage,
    projectId,
}: {
    usage: InstanceLimitUsage
    projectId: string
}) => {
    const t = useT(limitRefusalCatalog, settingsLicenseCatalog)
    const usageText = useLimitUsageText()
    const {isInstanceAdmin} = useInstanceLicense(projectId)
    const [registering, setRegistering] = useState(false)

    return (
        <div
            role="status"
            className="bg-info/10 ring-info/30 flex flex-col gap-2.5 rounded-xl px-3.5 py-3 ring-1 ring-inset"
        >
            <LicenseUsageRow
                label={t("settings.license.usageProjects")}
                value={usageText("projects", usage)}
                count={usage.count}
                limit={usage.limit}
            />
            <p className="text-foreground m-0 text-body-sm">
                {t(
                    isInstanceAdmin
                        ? "shell.limitRefusal.projectLimitRegister"
                        : "shell.limitRefusal.projectLimitAskAdmin",
                )}
            </p>
            {isInstanceAdmin ? (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-start"
                    onClick={() => setRegistering(true)}
                >
                    {t("shell.limitRefusal.registerInstance")}
                </Button>
            ) : null}
            <RegistrationDialog
                open={registering}
                title={t("shell.limitRefusal.registerTitle")}
                projectId={projectId}
                onClose={() => setRegistering(false)}
            />
        </div>
    )
}
