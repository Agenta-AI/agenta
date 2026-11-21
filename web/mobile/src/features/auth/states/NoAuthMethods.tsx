import {useT} from "@agenta/i18n"
import signInCatalog from "@agenta/i18n/catalogs/auth.signIn"

/** Every method is disabled by env — say so instead of showing an empty card. */
export const NoAuthMethods = () => {
    const t = useT(signInCatalog)
    return (
        <p className="text-muted-foreground text-center text-xs">
            {t("auth.signIn.noAuthMethods")}
        </p>
    )
}
