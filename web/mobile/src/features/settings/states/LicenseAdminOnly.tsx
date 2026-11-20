import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"

/** What a reader who is not the instance admin sees on the License page. */
export const LicenseAdminOnly = () => {
    const t = useT(settingsLicenseCatalog)
    return (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-[13px]">
            {t("settings.license.adminOnly")}
        </div>
    )
}
