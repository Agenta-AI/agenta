import {richText, useT, type CatalogKey} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {Check} from "@phosphor-icons/react"

const GAINS: CatalogKey<typeof settingsLicenseCatalog>[] = [
    "settings.license.gainProjects",
    "settings.license.gainFeatures",
    "settings.license.gainSecurity",
]

/** What a free key unlocks, before the registration form. */
export const RegistrationGains = () => {
    const t = useT(settingsLicenseCatalog)
    return (
        <div className="flex flex-col gap-2">
            <p className="text-foreground m-0 text-body-sm">{t("settings.license.gainsIntro")}</p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {GAINS.map((gain) => (
                    <li key={gain} className="flex items-start gap-2 text-body-sm">
                        <Check size={14} weight="bold" className="text-success mt-[3px] shrink-0" />
                        <span>
                            {richText(t(gain), {
                                strong: (text) => <strong className="font-semibold">{text}</strong>,
                            })}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
